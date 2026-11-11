import { useState } from 'react';

const inputClass =
  "w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30";

/**
 * Form to choose a new password, used in two cases:
 * - after the login with a temporary password (the hiker must change it);
 * - from the link of the password recovery email (/reset-password?token=...).
 * The subtitle explains the case.
 */
export default function ChangePasswordForm({
  onChangePassword,
  subtitle = "You logged in with a temporary password. Choose a new one to continue.",
}) {
  const [formData, setFormData] = useState({ password: '', repeatPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (formData.password.length < 6) {
      setError("The password must contain at least 6 characters.");
      return;
    }

    if (formData.password !== formData.repeatPassword) {
      setError("The two passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await onChangePassword(formData.password);
    } catch (err) {
      setError(err.message || "Could not change the password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0e1622]/90 p-7 shadow-2xl shadow-black/20 sm:p-10">

        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Choose a new password
          </h2>
          <p className="mt-3 text-sm text-slate-400">
            {subtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-slate-200">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              className={inputClass}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              minLength={6}
            />
          </div>

          <div>
            <label htmlFor="repeat-password" className="mb-2 block text-sm font-medium text-slate-200">
              Repeat password
            </label>
            <input
              id="repeat-password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              className={inputClass}
              value={formData.repeatPassword}
              onChange={(e) => setFormData({ ...formData, repeatPassword: e.target.value })}
              required
              minLength={6}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex min-w-0 items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm leading-relaxed text-red-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>

              <span className="min-w-0 flex-1 break-words">
                {error}
              </span>
            </div>
          )}

          <button type="submit" disabled={loading} className="mt-2 flex w-full cursor-pointer items-center justify-center rounded-xl bg-sky-300 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? (<span className="loading loading-spinner loading-sm"></span>) : ('Save new password')}
          </button>
        </form>
      </div>
    </div>
  );
}