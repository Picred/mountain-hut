import { useState } from 'react';
import { useNavigate } from 'react-router';

export default function RegisterForm({ onRegister }) {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await onRegister(formData.name, formData.email, formData.phone, formData.password);
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
            Create an account
          </h2>
          <p className="text-sm text-center text-base-content/70 mb-4">
            Insert your data to register
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium">Name and surname</span>
              </label>
              <input 
                type="text" 
                placeholder="Mario Rossi" 
                className="input input-bordered w-full"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                required
              />
            </div>

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
                <span className="label-text font-medium">Phone number</span>
              </label>
              <input 
                type="tel" 
                placeholder="333 1234567" 
                className="input input-bordered w-full"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
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
                minLength={6}
              />
            </div>

            <button type="submit" className="btn btn-primary w-full mt-4" disabled={loading}>
              {loading ? <span className="loading loading-spinner loading-xs"></span> : 'Register'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}