import { Component, type ReactNode } from "react";
import { useLocaleStore } from "../i18n";
import th from "../i18n/th.json";
import en from "../i18n/en.json";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const dictMap = { th, en } as Record<string, Record<string, string>>;

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const locale = useLocaleStore.getState().locale;
      const dict = dictMap[locale] ?? th;

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center p-8 max-w-md">
            <h1 className="text-2xl font-bold text-gray-800 mb-4">
              {dict["errorBoundary.title"]}
            </h1>
            <p className="text-gray-600 mb-6">
              {dict["errorBoundary.desc"]}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {dict["errorBoundary.refresh"]}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
