// ============================================================
// dashboard.js — Real-time dashboard for Smart Irrigation
// ============================================================
// IMPORTANT: Replace the two values below with your own from
// the Supabase project dashboard → Settings → API
// ============================================================

const SUPABASE_URL  = 'https://jfqkxnscwacihwxauqqk.supabase.co';   // ← replace
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmcWt4bnNjd2FjaWh3eGF1cXFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODIxNzQsImV4cCI6MjA4ODM1ODE3NH0.K6Fb9UaeyZJEM74DstZspk0_ytrx_duAari1AGr2wdQ';                  // ← replace

const REFRESH_INTERVAL_MS = 5000;   // Poll every 5 seconds as a fallback
const TABLE_NAME           = 'sensor_readings';
const CHART_POINTS         = 20;    // How many readings to show on chart
const RECENT_ROWS          = 10;    // Rows shown in the table

// Initialise Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let moistureChart = null;  // Chart.js instance
let realtimeSub   = null;  // Supabase realtime subscription

// ============================================================
// AUTH GUARD — redirect to login if not authenticated
// ============================================================
async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

// ============================================================
// INITIALISE DASHBOARD
// ============================================================
async function init() {
  const authed = await checkAuth();
  if (!authed) return;

  // Show the dashboard, hide loading overlay
  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('dashLayout').classList.remove('hidden');

  // Build the chart with no data yet
  initChart();

  // Load data for the first time
  await loadData();

  // Subscribe to real-time inserts from Supabase
  subscribeRealtime();

  // Fallback polling in case realtime misses something
  setInterval(loadData, REFRESH_INTERVAL_MS);
}

// ============================================================
// LOAD DATA FROM SUPABASE
// ============================================================
async function loadData() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(CHART_POINTS);

  if (error) {
    console.error('Error fetching readings:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    document.getElementById('readingsBody').innerHTML =
      '<tr><td colspan="5" style="text-align:center; color:var(--text-dim)">No readings yet.</td></tr>';
    return;
  }

  // The newest reading is data[0]
  updateKPICards(data[0]);

  // Chart expects oldest first
  const chronological = [...data].reverse();
  updateChart(chronological);

  // Table shows newest first
  updateTable(data.slice(0, RECENT_ROWS));
}

// ============================================================
// SUPABASE REALTIME SUBSCRIPTION
// ============================================================
function subscribeRealtime() {
  realtimeSub = supabase
    .channel('sensor-readings-channel')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: TABLE_NAME },
      (payload) => {
        // A new row was inserted — refresh everything
        loadData();
      }
    )
    .subscribe();
}

// ============================================================
// UPDATE KPI CARDS (top row)
// ============================================================
function updateKPICards(row) {
  // ---- Moisture ----
  const moisture = row.moisture_percent !== null
    ? row.moisture_percent.toFixed(1)
    : '--';
  document.getElementById('kpiMoisture').innerHTML =
    `${moisture}<span class="unit">%</span>`;

  const status = row.moisture_status || '—';
  const statusEl = document.getElementById('kpiMoistureStatus');
  statusEl.textContent = status;
  statusEl.className = `kpi-sub status-${status.toLowerCase()}`;

  // ---- Pump ----
  const pumpOn = row.pump_state === true;
  document.getElementById('kpiPump').textContent = pumpOn ? 'ON' : 'OFF';
  const pumpSub = document.getElementById('kpiPumpSub');
  pumpSub.textContent = pumpOn ? 'Watering active' : 'Pump idle';
  pumpSub.className = `kpi-sub ${pumpOn ? 'status-on' : 'status-off'}`;

  // ---- Distance ----
  const dist = row.distance_cm !== null
    ? row.distance_cm.toFixed(1)
    : '--';
  document.getElementById('kpiDistance').innerHTML =
    `${dist}<span class="unit">cm</span>`;

  const detected = row.object_detected;
  const detEl = document.getElementById('kpiDetected');
  detEl.textContent = detected ? '⚠ Object detected' : 'Path clear';
  detEl.className = `kpi-sub ${detected ? 'status-on' : 'status-moist'}`;

  // ---- Red LED ----
  const redOn = row.red_led_state === true;
  document.getElementById('redLedText').textContent = redOn ? 'ON' : 'OFF';
  const redDot = document.getElementById('redLedDot');
  redDot.className = `led-dot ${redOn ? 'on-red' : ''}`;

  // ---- Green LED ----
  const greenOn = row.green_led_state === true;
  document.getElementById('greenLedText').textContent = greenOn ? 'ON' : 'OFF';
  const greenDot = document.getElementById('greenLedDot');
  greenDot.className = `led-dot ${greenOn ? 'on-green' : ''}`;

  // ---- Timestamp ----
  const ts = row.timestamp
    ? new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--';
  document.getElementById('kpiTimestamp').textContent = ts;
}

// ============================================================
// CHART SETUP & UPDATE
// ============================================================
function initChart() {
  const ctx = document.getElementById('moistureChart').getContext('2d');
  moistureChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Moisture %',
        data: [],
        borderColor: '#3ddc84',
        backgroundColor: 'rgba(61,220,132,0.08)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#3ddc84',
        tension: 0.4,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#101f16',
          borderColor: '#1e3828',
          borderWidth: 1,
          titleColor: '#5e8069',
          bodyColor: '#d4ead9',
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#5e8069', font: { family: 'Space Mono', size: 10 }, maxTicksLimit: 8 },
          grid: { color: '#1e3828' }
        },
        y: {
          min: 0, max: 100,
          ticks: {
            color: '#5e8069',
            font: { family: 'Space Mono', size: 10 },
            callback: v => v + '%'
          },
          grid: { color: '#1e3828' }
        }
      }
    }
  });
}

function updateChart(rows) {
  const labels = rows.map(r =>
    new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const values = rows.map(r => r.moisture_percent ?? null);

  moistureChart.data.labels  = labels;
  moistureChart.data.datasets[0].data = values;
  moistureChart.update('none'); // 'none' = no animation for smooth updates
}

// ============================================================
// READINGS TABLE
// ============================================================
function updateTable(rows) {
  const tbody = document.getElementById('readingsBody');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim)">No data.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const time  = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const moist = r.moisture_percent !== null ? r.moisture_percent.toFixed(1) + '%' : '--';
    const statusBadge = statusToBadge(r.moisture_status);
    const pumpBadge   = pumpToBadge(r.pump_state);
    const dist  = r.distance_cm !== null ? r.distance_cm.toFixed(1) + ' cm' : '--';

    return `
      <tr>
        <td>${time}</td>
        <td>${moist}</td>
        <td>${statusBadge}</td>
        <td>${pumpBadge}</td>
        <td>${dist}</td>
      </tr>
    `;
  }).join('');
}

function statusToBadge(status) {
  if (!status) return '—';
  const cls = status.toLowerCase(); // wet / moist / dry
  return `<span class="badge badge-${cls}">${status}</span>`;
}

function pumpToBadge(state) {
  if (state === null || state === undefined) return '—';
  return state
    ? '<span class="badge badge-on">ON</span>'
    : '<span class="badge badge-off">OFF</span>';
}

// ============================================================
// LOGOUT
// ============================================================
async function handleLogout() {
  if (realtimeSub) {
    await supabase.removeChannel(realtimeSub);
  }
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// ============================================================
// START
// ============================================================
init();
