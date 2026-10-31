import { Outlet } from "react-router"
import { Navbar } from "../components/Navbar"

export const Layout = ({ user, loggedIn, onLogout }) => {
  return (
    <div className="min-h-screen bg-[#080e18]">
      <Navbar user={user} loggedIn={loggedIn} onLogout={onLogout} />
      {/* Main content */}
      <main className="min-h-[calc(100vh-76px)] flex items-center justify-center bg-[linear-gradient(90deg,rgba(8,14,24,0.84),rgba(8,14,24,0.53)),url('https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2200&q=85')] bg-cover bg-center bg-fixed">
        <Outlet />
      </main>
      {/* Footer */}
    </div>
  )
}