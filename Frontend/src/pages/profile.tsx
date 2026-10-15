import { Navigate } from 'react-router-dom'

// Profile is now consolidated into the Settings page
export default function Profile() {
  return <Navigate to="/settings" replace />
}
