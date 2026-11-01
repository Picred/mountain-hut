import { useState } from 'react';
import { Link, useNavigate } from 'react-router'; // oppure 'react-router-dom'

export default function LoginForm({ onLogin }) {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onLogin(formData.email, formData.password);
    } catch (err) {
      setError(err.message || "Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-12">
      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0e1622]/90 p-7 shadow-2xl shadow-black/20 sm:p-10">

        {/* Go back button */}
        <button
          type="button"
          onClick={() => navigate("/")}
          className="absolute left-6 top-6 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition-colors hover:border-sky-300/30 hover:bg-white/5 hover:text-sky-300"
          aria-label="Back to homepage"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="text-white">
            <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
          </svg>
        </button>

        <div className="mb-8 pt-8 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Welcome back!
          </h2>
          <p className="mt-3 text-sm text-slate-400">
            Log into your account to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200">
              Email address
            </label>
            <input
              type="email"
              placeholder="mario@example.com"
              className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200">
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
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
            {loading ? (<span className="loading loading-spinner loading-sm"></span>) : ('Log in')}
          </button>
        </form>

        <div className="mt-8 border-t border-white/10 pt-6 text-center text-sm">
          <span className="text-slate-400">
            Don't have an account?{" "}
          </span>

          <Link
            to="/register"
            className="font-semibold text-sky-300 transition-colors hover:text-sky-200"
          >
            Register now
          </Link>
        </div>
      </div>
    </div>
  );
}