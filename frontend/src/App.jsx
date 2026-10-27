import './App.css'
import { Routes, Route } from 'react-router'
export const App = () => {

  return (
    <Routes>
      <Route path="/" element={<p> Layout </p>}>
        <Route index element={<p> Homepage </p>} />
        <Route path="*" element={<p> Not Found </p>} />
      </Route>
    </Routes>
  )
}