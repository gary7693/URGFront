import { Routes, Route, Navigate } from 'react-router-dom'
import LidarPage from './pages/LidarPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/lidar" replace />} />
      <Route path="/lidar" element={<LidarPage />} />
      <Route path="*" element={<Navigate to="/lidar" replace />} />
    </Routes>
  )
}
