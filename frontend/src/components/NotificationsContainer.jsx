import { useContext } from 'react'
import { NotificationsContext } from '../context/NotificationsContext'

export function NotificationsContainer() {
  const { notifications } = useContext(NotificationsContext)

  return (
    <div className="notifications-container">
      {notifications.map(notif => (
        <div key={notif.id} className={`notification notification-${notif.type}`}>
          {notif.message}
        </div>
      ))}
    </div>
  )
}