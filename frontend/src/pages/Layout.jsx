import { Outlet } from "react-router"
import { Navbar } from "../components/Navbar"

export const Layout = () => {
  return (
    <>
      <Navbar />
      {/* Main content */}
      <Outlet />
      {/* Footer */}
    </>
  )
}