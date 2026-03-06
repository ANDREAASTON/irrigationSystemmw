// ============================================================
// app.js — Login & Signup logic for Smart Irrigation Monitor
// ============================================================

const SUPABASE_URL  = 'https://jfqkxnscwacihwxauqqk.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmcWt4bnNjd2FjaWh3eGF1cXFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODIxNzQsImV4cCI6MjA4ODM1ODE3NH0.K6Fb9UaeyZJEM74DstZspk0_ytrx_duAari1AGr2wdQ';

// ---- Wait for the full page to load before running anything ----
window.addEventListener('load', function () {

  // Safety check: make sure Supabase CDN loaded correctly
  if (!window.supabase) {
    showError('Supabase library failed to load. Check your internet connection.');
    return;
  }

  // Initialise Supabase client
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // ----------------------------------------------------------
  // Redirect to dashboard if already logged in
  // ----------------------------------------------------------
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      window.location.href = 'dashboard.html';
    }
  });

  // ----------------------------------------------------------
  // Show / hide message boxes
  // Uses inline styles as a fallback in case CSS fails to load
  // ----------------------------------------------------------
  function showError(msg) {
    const el = document.getElementById('errorMsg');
    if (!el) { alert('Error: ' + msg); return; }
    el.textContent = msg;
    el.style.display = 'block';
    const info = document.getElementById('infoMsg');
    if (info) info.style.display = 'none';
    console.error('[Login Error]', msg);
  }

  function showInfo(msg) {
    const el = document.getElementById('infoMsg');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.style.display = 'block';
    const err = document.getElementById('errorMsg');
    if (err) err.style.display = 'none';
  }

  function clearMessages() {
    const err  = document.getElementById('errorMsg');
    const info = document.getElementById('infoMsg');
    if (err)  err.style.display  = 'none';
    if (info) info.style.display = 'none';
  }

  // ----------------------------------------------------------
  // Toggle between Login / Signup panels
  // ----------------------------------------------------------
  function showSignup() {
    document.getElementById('loginForm').style.display  = 'none';
    document.getElementById('signupForm').style.display = 'block';
    clearMessages();
  }

  function showLogin() {
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display  = 'block';
    clearMessages();
  }

  // Expose to onclick attributes in HTML
  window.showSignup = showSignup;
  window.showLogin  = showLogin;

  // ----------------------------------------------------------
  // Button loading state
  // ----------------------------------------------------------
  function setLoading(btnId, loading, label) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait…' : label;
  }

  // ----------------------------------------------------------
  // LOGIN
  // ----------------------------------------------------------
  async function handleLogin() {
    clearMessages();

    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }

    setLoading('loginBtn', true, 'Login');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // Translate common Supabase error codes into friendly messages
        if (error.message.includes('Invalid login credentials')) {
          showError('Incorrect email or password. Please try again.');
        } else if (error.message.includes('Email not confirmed')) {
          showError('Please confirm your email first, or disable email confirmation in Supabase.');
        } else {
          showError(error.message);
        }
        return;
      }

      if (data.session) {
        showInfo('Login successful! Redirecting…');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
      }

    } catch (err) {
      showError('Network error — check your internet connection and try again.');
      console.error('Login exception:', err);
    } finally {
      setLoading('loginBtn', false, 'Login');
    }
  }

  // ----------------------------------------------------------
  // SIGNUP
  // ----------------------------------------------------------
  async function handleSignup() {
    clearMessages();

    const email    = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;

    if (!email || !password) {
      showError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      showError('Password must be at least 6 characters.');
      return;
    }

    setLoading('signupBtn', true, 'Create Account');

    try {
      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        showError(error.message);
        return;
      }

      showInfo('Account created! Check your email to confirm, then log in.');
      showLogin();

    } catch (err) {
      showError('Network error — check your internet connection and try again.');
      console.error('Signup exception:', err);
    } finally {
      setLoading('signupBtn', false, 'Create Account');
    }
  }

  // Expose to onclick attributes in HTML
  window.handleLogin  = handleLogin;
  window.handleSignup = handleSignup;

  // ----------------------------------------------------------
  // Enter key support
  // ----------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const loginVisible = document.getElementById('loginForm').style.display !== 'none'
                      && !document.getElementById('loginForm').classList.contains('hidden');
    if (loginVisible) {
      handleLogin();
    } else {
      handleSignup();
    }
  });

}); // end window.load