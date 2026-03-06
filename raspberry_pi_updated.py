"""
raspberry_pi_updated.py
=======================
Smart Irrigation Monitor — Updated Raspberry Pi Code
Adds Supabase data upload to the existing sensor + GPIO logic.

CHANGES vs your original code:
  1. Added 'requests' library import for HTTP calls to Supabase REST API.
  2. Added SUPABASE_URL and SUPABASE_SERVICE_KEY constants (top of file).
  3. Added send_to_supabase() function that POSTs a reading via REST.
  4. Called send_to_supabase() inside the main loop, after each sensor
     update, wrapped in try/except so the Pi never crashes on a failed upload.

INSTALL requirements on the Pi:
  pip3 install requests RPi.GPIO spidev RPLCD

SECURITY NOTE:
  The service_role key below bypasses Row Level Security.
  Keep this file on the Pi only — never share or commit it publicly.
  If you use .gitignore, add raspberry_pi_updated.py or store the key
  in a separate .env file and load it with python-dotenv.
"""

from RPLCD.i2c import CharLCD
import spidev
import RPi.GPIO as GPIO
import time
import requests   # ← NEW: install with: pip3 install requests


# ============================================================
# NEW: Supabase connection details
# Get these from: Supabase Dashboard → Settings → API
# ============================================================
SUPABASE_URL         = "https://jfqkxnscwacihwxauqqk.supabase.co"   # ← replace
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmcWt4bnNjd2FjaWh3eGF1cXFrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc4MjE3NCwiZXhwIjoyMDg4MzU4MTc0fQ.JrRBTEPXBThg_me1SsuDDPgFDRM9WoyiYxHRp8ccfCU"                 # ← replace (keep secret!)

# The REST endpoint for the sensor_readings table
SUPABASE_ENDPOINT = f"{SUPABASE_URL}/rest/v1/sensor_readings"

# Headers required by Supabase REST API
SUPABASE_HEADERS = {
    "apikey":        SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal",  # don't need the inserted row back
}


# ============================================================
# NEW: Function to send one reading to Supabase
# ============================================================
def send_to_supabase(moisture_percent, moisture_status, pump_state,
                     distance_cm, object_detected,
                     red_led_state, green_led_state):
    """
    POST a sensor reading to the Supabase sensor_readings table.
    If the upload fails, print the error and continue — the Pi
    program will NOT crash.

    Parameters
    ----------
    moisture_percent : float   — e.g. 65.4
    moisture_status  : str     — 'Wet', 'Moist', or 'Dry'
    pump_state       : bool    — True if pump is ON
    distance_cm      : float or None — None if ultrasonic timed out
    object_detected  : bool    — True if distance < DISTANCE_THRESHOLD
    red_led_state    : bool    — True if red LED is ON
    green_led_state  : bool    — True if green LED is ON
    """
    payload = {
        "moisture_percent": round(moisture_percent, 2),
        "moisture_status":  moisture_status,
        "pump_state":       pump_state,
        "distance_cm":      round(distance_cm, 2) if distance_cm is not None else None,
        "object_detected":  object_detected,
        "red_led_state":    red_led_state,
        "green_led_state":  green_led_state,
        # 'timestamp' is omitted — Supabase uses DEFAULT NOW()
    }

    try:
        response = requests.post(
            SUPABASE_ENDPOINT,
            headers=SUPABASE_HEADERS,
            json=payload,
            timeout=5          # don't block the loop for more than 5 s
        )
        if response.status_code not in (200, 201):
            print(f"[Supabase] Upload warning: {response.status_code} {response.text}")
        else:
            print(f"[Supabase] Reading uploaded OK — moisture={moisture_percent:.1f}%")

    except requests.exceptions.RequestException as e:
        # Network error, timeout, DNS fail, etc. — just log and carry on.
        print(f"[Supabase] Upload failed (network error): {e}")


# ============================================================
# -------- SPI setup for MCP3008 (Soil Moisture) --------
# (UNCHANGED from your original code)
# ============================================================
spi = spidev.SpiDev()
spi.open(0, 0)
spi.max_speed_hz = 1350000

def ReadChannel(channel):
    adc = spi.xfer2([1, (8 + channel) << 4, 0])
    data = ((adc[1] & 3) << 8) + adc[2]
    return data


# -------- I2C LCD setup (UNCHANGED) --------
lcd = CharLCD('PCF8574', 0x27, cols=16, rows=2)
lcd.clear()


# -------- GPIO setup (UNCHANGED) --------
PUMP_PIN   = 4
TRIG       = 23
ECHO       = 24
LED_RED    = 27
LED_GREEN  = 17

GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
GPIO.cleanup()

GPIO.setup(PUMP_PIN,  GPIO.OUT)
GPIO.output(PUMP_PIN, GPIO.LOW)   # Pump OFF initially

GPIO.setup(TRIG,      GPIO.OUT)
GPIO.setup(ECHO,      GPIO.IN)
GPIO.setup(LED_RED,   GPIO.OUT)
GPIO.setup(LED_GREEN, GPIO.OUT)
GPIO.output(LED_RED,  GPIO.LOW)
GPIO.output(LED_GREEN, GPIO.LOW)


# -------- Distance Measurement (UNCHANGED) --------
def measure_distance(timeout=1.0):
    """Measure distance using ultrasonic sensor with timeout."""
    GPIO.output(TRIG, False)
    time.sleep(0.0005)

    GPIO.output(TRIG, True)
    time.sleep(0.00001)
    GPIO.output(TRIG, False)

    start_time = time.time()
    pulse_start = None
    pulse_end   = None

    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
        if pulse_start - start_time > timeout:
            return None

    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
        if pulse_end - start_time > timeout:
            return None

    if pulse_start is None or pulse_end is None:
        return None

    pulse_duration = pulse_end - pulse_start
    distance = round(pulse_duration * 17150, 2)
    return distance


# -------- Constants (UNCHANGED) --------
DISTANCE_THRESHOLD = 10   # cm
pump_state         = False
last_lcd_update    = 0
LCD_UPDATE_INTERVAL = 2   # seconds


# ============================================================
# MAIN LOOP
# The only additions are:
#   - tracking current LED & distance state in variables
#   - calling send_to_supabase() after each LCD/sensor update
# ============================================================
try:
    # Track current LED/distance state so we can pass it to Supabase
    current_distance      = None
    current_object_detect = False
    current_red_led       = False
    current_green_led     = False

    while True:
        current_time = time.time()

        # -------- Soil Moisture Section (every 2 s) --------
        if current_time - last_lcd_update > LCD_UPDATE_INTERVAL:
            soil_level = ReadChannel(0)
            moisture   = 100 - ((soil_level / 1023.0) * 100)

            if moisture > 70:
                status        = "Wet"
                desired_state = False
            elif 30 <= moisture <= 69:
                status        = "Moist"
                desired_state = False
            else:
                status        = "Dry"
                desired_state = True

            # Update pump if state changed
            if desired_state != pump_state:
                pump_state = desired_state
                GPIO.output(PUMP_PIN, GPIO.HIGH if pump_state else GPIO.LOW)

            # Update LCD
            lcd.clear()
            lcd.write_string("Soil moisture:")
            lcd.crlf()
            lcd.write_string("{:.1f}% - {}".format(moisture, status))

            last_lcd_update = current_time

            # ------------------------------------------------
            # NEW: Send the combined reading to Supabase.
            # Placed here so we upload once per LCD interval (every 2 s),
            # keeping database writes at a sensible rate.
            # current_distance / LED states are updated by the ultrasonic
            # section below (they reflect the most recent measurement).
            # ------------------------------------------------
            send_to_supabase(
                moisture_percent = moisture,
                moisture_status  = status,
                pump_state       = pump_state,
                distance_cm      = current_distance,
                object_detected  = current_object_detect,
                red_led_state    = current_red_led,
                green_led_state  = current_green_led,
            )

        # -------- Ultrasonic Section (runs every ~0.2 s) --------
        distance = measure_distance()
        if distance is not None:
            current_distance = distance   # ← NEW: keep track for Supabase

            if distance < DISTANCE_THRESHOLD:
                GPIO.output(LED_RED,   GPIO.HIGH)
                GPIO.output(LED_GREEN, GPIO.LOW)
                current_object_detect = True    # ← NEW
                current_red_led       = True     # ← NEW
                current_green_led     = False    # ← NEW
            else:
                GPIO.output(LED_RED,   GPIO.LOW)
                GPIO.output(LED_GREEN, GPIO.HIGH)
                current_object_detect = False   # ← NEW
                current_red_led       = False   # ← NEW
                current_green_led     = True    # ← NEW

        time.sleep(0.2)   # short delay for smoother LED updates

except KeyboardInterrupt:
    GPIO.output(PUMP_PIN,  GPIO.LOW)
    GPIO.output(LED_RED,   GPIO.LOW)
    GPIO.output(LED_GREEN, GPIO.LOW)
    GPIO.cleanup()
    lcd.clear()
    lcd.write_string("Stopped")
    print("Program stopped safely")
