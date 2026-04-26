import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#fee2e2', color: '#991b1b', fontFamily: 'monospace', minHeight: '100vh', boxSizing: 'border-box' }}>
          <h2>Something went wrong (Mini App Crash)</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '10px', fontWeight: 'bold' }}>
              {this.state.error && this.state.error.toString()}
            </summary>
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
          <br />
          <p>Please share this screen with the developer.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
