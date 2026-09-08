import { useEffect } from 'react';
import { useStore, goToStep, initPort } from './store';
import { Stepper } from './components/Stepper';
import { ImportScreen } from './screens/ImportScreen';
import { PreviewScreen } from './screens/PreviewScreen';
import { ConfigScreen } from './screens/ConfigScreen';
import { RunScreen } from './screens/RunScreen';

export function App() {
  const { step, batch } = useStore((s) => s);

  useEffect(() => {
    initPort();
  }, []);

  // 08.1: nếu có batch đang running/paused/stopped_* khi mở panel, nhảy thẳng vào Run.
  useEffect(() => {
    if (batch && (batch.status === 'running' || batch.status === 'paused' || batch.status === 'stopped_rate_limit' || batch.status === 'needs_attention')) {
      goToStep('run');
    }
  }, [batch?.status]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Visual Generator</h1>
        <Stepper current={step} onSelect={goToStep} />
      </header>
      <main className="app-main">
        {step === 'import' && <ImportScreen />}
        {step === 'preview' && <PreviewScreen />}
        {step === 'config' && <ConfigScreen />}
        {step === 'run' && <RunScreen />}
      </main>
    </div>
  );
}
