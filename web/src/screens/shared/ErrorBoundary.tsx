import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '../../components/ErrorState';

/**
 * Catches a screen that crashes while rendering so the sidebar and the rest
 * of the app keep working. `resetKey` (the URL) clears the error on navigation.
 */
interface Props {
  children: ReactNode;
  resetKey: string;
}
interface State {
  error: unknown;
  key: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Screen crashed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
