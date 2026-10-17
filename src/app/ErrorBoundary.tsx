// Last line of defence: a render error (or a screen's code chunk that failed to
// load, e.g. after a new version was deployed) shows a friendly card with a
// "Restart" button instead of a blank white page. Progress is saved by the
// store, so a restart loses nothing but the move being played.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app-crash" role="alert">
        <div className="app-crash__card">
          <div className="app-crash__emoji" aria-hidden>
            🦉
          </div>
          <h1 className="app-crash__title">Oops! Something went wrong.</h1>
          <p className="app-crash__text">Don't worry — your coins and progress are saved. Tap the button to start the app again.</p>
          <button type="button" className="app-crash__btn" onClick={() => window.location.reload()}>
            ↻ Restart
          </button>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
