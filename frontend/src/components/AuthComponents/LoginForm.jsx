import { useState } from 'react';
import { Link, useNavigate } from 'react-router'; // oppure 'react-router-dom'

export default function LoginForm({ onLogin }) {
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await onLogin(formData.email, formData.password);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-md bg-base-100 shadow-xl border border-base-300 relative">
        
        {/* Go back button */}
        <button 
          type="button"
          onClick={() => navigate("/")} 
          className="btn btn-ghost btn-circle btn-sm absolute top-4 left-4"
          aria-label="Torna indietro"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </button>

        <div className="card-body pt-12"> 
          <h2 className="card-title text-2xl font-bold text-center justify-center mb-1">
            Welcome back!
          </h2>
          <p className="text-sm text-center text-base-content/70 mb-4">
            Log into your account to continue
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium">Email</span>
              </label>
              <input 
                type="email" 
                placeholder="mario@example.com" 
                className="input input-bordered w-full"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
              />
            </div>

            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium">Password</span>
              </label>
              <input 
                type="password" 
                placeholder="••••••••" 
                className="input input-bordered w-full"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary w-full mt-2" disabled={loading}>
              {loading ? <span className="loading loading-spinner loading-xs"></span> : 'Log in'}
            </button>
          </form>

          <div className="divider text-sm mt-6">or</div>
          <div className="text-center text-sm">
            <span className="text-base-content/70">Don't have an account? </span>
            <Link to="/register" className="link link-primary font-semibold">
              Register now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}