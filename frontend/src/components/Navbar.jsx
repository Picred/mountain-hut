import { useNavigate } from "react-router"

export const Navbar = () => {
  const navigate = useNavigate()

  return (
    /* Header fisso in alto con sfocatura dello sfondo (Glassmorphism) */
    <header className="sticky top-0 z-50 bg-neutral-900/80 backdrop-blur-md border-b border-neutral-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="navbar min-h-16 px-0 justify-between">
          
          {/* Logo con icona del brand */}
          <div className="flex-1">
            <button 
              onClick={() => navigate("/")} 
              className="btn btn-ghost normal-case text-xl font-bold tracking-wide text-white hover:bg-neutral-800/60 gap-2.5 px-2"
            >
              {/* Icona Montagna/Rifugio */}
              <svg className="w-6 h-6 text-red-500 fill-current" viewBox="0 0 24 24">
                <path d="M14 6l-3.8 5.7 1.4 1.4L14 9.5 19 17H5l4-6 2.1 3.1 1.4-1.4L8 6l-6 9h20L14 6z" />
              </svg>
              <span>Mountain Hut</span>
            </button>
          </div>

          {/* Sezione Azioni e Profilo */}
          <div className="flex items-center gap-2 sm:gap-3">
            
            {/* CTA Principale: Prenota un tavolo (accentuata col colore rosso/coral) */}
            <button 
              className="btn btn-error btn-sm text-white font-medium shadow-md hover:shadow-lg transition-all gap-1.5"
              onClick={() => navigate("/reservations")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">Reserve a table</span>
              <span className="sm:hidden">Book</span>
            </button>

            {/* Pulsante Login secondario */}
            <button 
              className="btn btn-ghost btn-sm text-neutral-300 hover:text-white hover:bg-neutral-800"
              onClick={() => navigate("/login")}
            >
              Login
            </button>

            {/* Dropdown Profilo Utente */}
            <div className="dropdown dropdown-end">
              <div 
                tabIndex={0} 
                role="button" 
                className="btn btn-ghost btn-circle avatar ring-2 ring-neutral-700 hover:ring-red-500 transition-all"
              >
                <div className="w-8 sm:w-9 rounded-full">
                  <img alt="User Avatar" src="/favicon.svg" />
                </div>
              </div>

              <ul
                tabIndex={0}
                className="dropdown-content menu p-2 mt-3 z-50 w-56 rounded-xl bg-neutral-800 text-neutral-200 border border-neutral-700 shadow-xl space-y-1"
              >
                <li className="menu-title text-neutral-400 text-[11px] px-3 py-1 font-semibold uppercase tracking-wider border-b border-neutral-700 mb-1">
                  My Account
                </li>
                <li>
                  <button 
                    onClick={() => navigate("/my-reservations")}
                    className="hover:bg-neutral-700 hover:text-white rounded-lg py-2 flex items-center gap-2 text-xs"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    My Reservations
                  </button>
                </li>
                <li>
                  <a className="hover:bg-red-500/10 hover:text-red-400 rounded-lg py-2 flex items-center gap-2 text-xs text-error">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Logout
                  </a>
                </li>
              </ul>
            </div>

          </div>

        </div>
      </div>
    </header>
  )
}