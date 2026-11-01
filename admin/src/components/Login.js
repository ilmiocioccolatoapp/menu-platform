import { useState } from 'react';
import { supabase } from '../supabase';
import { BakerySealIcon } from './Icons';

const EyeIcon = ({ hidden = false }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="2.5" />
    {hidden && <path d="m3 3 18 18" />}
  </svg>
);

const Login = ({ configError, authError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!supabase) {
      setError('Supabase is not configured for this admin app.');
      return;
    }
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) setError(signInError.message);
    } catch (signInError) {
      setError(signInError.message || 'Could not sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sendReset = async () => {
    setError(''); setNotice('');
    if (!supabase || !email.trim()) { setError('Enter your email address first.'); return; }
    setLoading(true);
    try {
      const redirectTo = window.location.origin + '/set-password';
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (resetError) setError(resetError.message);
      else setNotice('If an account exists for this address, Supabase will email a password setup link.');
    } catch (resetError) { setError(resetError.message || 'Could not send a password setup email.'); }
    finally { setLoading(false); }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <BakerySealIcon style={{ width: '28px', height: '28px', color: 'var(--accent)' }} />
          <p>Menu Platform</p>
        </div>
        <h1>Admin sign in</h1>
        <p className="auth-description">Sign in with your authorized account.</p>

        {(configError || authError || error) && (
          <div className="auth-error" role="alert">
            {configError || authError || error}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={!supabase || loading}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <div className="auth-password-field">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={!supabase || loading}
              />
              <button
                className="auth-password-toggle"
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={!supabase || loading}
              >
                <EyeIcon hidden={showPassword} />
              </button>
            </div>
          </div>

          <button
            className="btn btn-primary auth-submit"
            type="submit"
            disabled={!supabase || loading}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <button className="btn btn-ghost auth-reset" type="button" disabled={!supabase || loading} onClick={sendReset}>Forgot password?</button>
      </section>
    </main>
  );
};

export default Login;
