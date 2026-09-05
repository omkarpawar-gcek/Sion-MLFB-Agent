import { useMemo, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Database,
  Download,
  Gauge,
  Printer,
  Search,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import {
  catalog,
  exampleCode,
  formatInput,
  humanDescription,
  primaryCatalog,
  sourceFor,
  type DecodeResult,
  type PositionResult,
  type ZCode,
} from '@/lib/decoder';

const queryClient = new QueryClient();
type Tab = 'decode' | 'catalog' | 'sources';

function AppShell() {
  const [tab, setTab] = useState<Tab>('decode');

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" data-testid="brand-sion-decoder">
          <div className="brand-mark">SION</div>
          <div className="brand-text">
            <div className="brand-title">MLFB Decoder</div>
            <div className="brand-subtitle">Siemens Vacuum Circuit-Breaker · 3AE5</div>
          </div>
        </div>
        <nav className="nav-links">
          <button className={`nav-link ${tab === 'decode' ? 'active' : ''}`} onClick={() => setTab('decode')}>Decode Code</button>
          <button className={`nav-link ${tab === 'catalog' ? 'active' : ''}`} onClick={() => setTab('catalog')}>Reference Catalog</button>
          <button className={`nav-link ${tab === 'sources' ? 'active' : ''}`} onClick={() => setTab('sources')}>Methodology & Sources</button>
        </nav>
      </header>

      {tab === 'decode' && <DecoderPage />}
      
      {tab === 'catalog' && (
        <main className="content-wrapper" style={{ paddingTop: '80px', paddingBottom: '80px' }}>
          <CatalogPage />
        </main>
      )}
      
      {tab === 'sources' && (
        <main className="content-wrapper" style={{ paddingTop: '80px', paddingBottom: '80px' }}>
          <SourcesPage />
        </main>
      )}

      <footer className="app-footer">
        © 2026 SION MLFB Decoder &nbsp;·&nbsp; Developed by Omkar Pawar
      </footer>
    </div>
  );
}

function DecoderPage() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<DecodeResult>();
  const [error, setError] = useState('');
  const [isDecoding, setIsDecoding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [diagramUrls, setDiagramUrls] = useState<string[] | undefined>();

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setError('');
    setResult(undefined);
    setCopied(false);
    setDiagramUrls(undefined);
    setIsDecoding(true);
    
    try {
      const res = await fetch('/api/decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mlfb: input })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to decode MLFB from server.');
      }
      const rawResult = data.decoded_result;
      
      const getSourcePage = (pos: number) => {
        if ([1, 2, 3, 4].includes(pos)) return 'p. 14';
        if ([5, 6, 7, 8].includes(pos)) return 'pp. 16–24';
        if (pos === 9) return 'p. 25';
        if (pos === 10) return 'p. 26';
        if ([11, 12].includes(pos)) return 'p. 27';
        if (pos === 13) return 'p. 28';
        if (pos === 14) return 'p. 29';
        if (pos === 15) return 'p. 30';
        return 'p. 31';
      };

      const getLabel = (pos: number) => {
        const labels: Record<number, string> = {
          1: 'Superior group', 2: 'Main group', 3: 'Subgroup', 4: 'Circuit-breaker version',
          5: 'Rated voltage', 6: 'Pole-center / terminal distance', 7: 'Short-circuit breaking current',
          8: 'Continuous current', 9: 'Release combination', 10: 'Closing solenoid',
          11: '1st release voltage', 12: '2nd release voltage', 13: 'Installation options',
          14: 'Drive motor voltage', 15: 'Low-voltage interface', 16: 'Language'
        };
        return labels[pos] || `Position ${pos}`;
      };

      const normalizedResult = {
        ...rawResult,
        formattedBase: rawResult.formattedBase || rawResult.formatted_base || rawResult.raw_base,
        primary: rawResult.primary_lookup ? {
          ...rawResult.primary_lookup,
          rated_voltage_kv: rawResult.primary_lookup.tier_kv,
          rated_short_circuit_breaking_current_ka: rawResult.primary_lookup.rated_scb_current_kA,
          rated_continuous_current_a: rawResult.primary_lookup.rated_continuous_current_A,
          vertical_distance_between_terminals_mm: rawResult.primary_lookup.vertical_distance_terminals_mm
        } : null,
        extras: rawResult.extras || rawResult.all_input_codes || [],
        warnings: rawResult.warnings || [],
        valid: rawResult.valid !== undefined ? rawResult.valid : !(rawResult.warnings || []).some((w: string) => w.startsWith('INVALID')),
        positionResults: (rawResult.decoded || []).map((item: any) => ({
          ...item,
          position: String(item.position),
          label: item.label || getLabel(item.position),
          sourcePage: item.sourcePage || item.source_page || getSourcePage(item.position)
        })),
        orderCodes: rawResult.orderCodes || rawResult.order_codes || [],
        unknownOrderCodes: rawResult.unknownOrderCodes || rawResult.unknown_order_codes || [],
      };
      
      setResult(normalizedResult);
      
      const diagRes = await fetch('/api/diagrams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mlfb: input })
      });
      let diagData;
      try {
        const textResponse = await diagRes.text();
        if (!textResponse.trim()) {
          throw new Error(`Server returned an empty response (HTTP ${diagRes.status}). This is likely a Gunicorn worker timeout.`);
        }
        diagData = JSON.parse(textResponse);
      } catch (err) {
        setError(`Diagrams failed: ${err instanceof Error ? err.message : 'Invalid JSON'}`);
        return;
      }

      if (!diagRes.ok) {
        setError(`Diagrams failed: ${diagData.error || 'Server error'}`);
        return;
      }

      if (diagData.output_pages) {
        setDiagramUrls(diagData.output_pages);
      }
    } catch (decodeError) {
      setError(decodeError instanceof Error ? decodeError.message : 'Unable to decode this article number.');
    } finally {
      setIsDecoding(false);
    }
  };

  const loadExample = () => {
    setInput(exampleCode);
    setError('');
    setResult(undefined);
    setDiagramUrls(undefined);
  };

  const copyResult = async () => {
    if (!result) return;
    const text = `${result.formattedBase}${result.extras.length ? ` -Z${result.extras.join('+')}` : ''}\n${humanDescription(result)}\nValidation: ${result.valid ? 'PASS' : 'REVIEW REQUIRED'}\n${result.warnings.join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Copy is unavailable in this browser. Use Export or Print instead.');
    }
  };

  const exportResult = () => {
    if (!result) return;
    const payload = {
      source: 'SION MLFB Decoder · HG 11.02 · 2026',
      ...result,
      human_description: humanDescription(result),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${result.formattedBase.replace(/-/g, '')}-decode.json`;
    link.click();
    URL.revokeObjectURL(href);
  };

  return (
    <>
      <div className="hero-wrapper">
        <section className="hero-section">
          <div className="hero-editorial">
            <div className="hero-eyebrow">SIEMENS SION 3AE5 · ENGINEERING CONFIGURATION</div>
            <h1 className="hero-title">Decode your SION configuration with precision.</h1>
            <p className="hero-desc">Enter a 16-position MLFB to retrieve technical specifications, configuration details and standardized wiring diagrams.</p>
            <div className="hero-badge">
              <span className="hero-badge-dot" /> LOCAL DATASET READY
            </div>
          </div>
          
          <div>
            <form className="decoder-card" onSubmit={submit} data-testid="decoder-input-panel">
              <div className="decoder-label">MLFB CODE</div>
              <input
                className="code-input"
                value={input}
                onChange={(event) => setInput(formatInput(event.target.value))}
                placeholder="e.g. 3AE51242AC906KN0L1BF30"
                spellCheck={false}
                data-testid="input-mlfb"
              />
              <button className="button-primary" type="submit" disabled={!input.trim() || isDecoding} data-testid="button-decode">
                {isDecoding ? 'Decoding...' : 'Decode MLFB'}
              </button>
              <div className="example-row">
                <span style={{ color: 'var(--text-muted)' }}>Known configuration example:</span>
                <span className="example-val">{exampleCode}</span>
              </div>
              <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <button type="button" className="link-btn" onClick={loadExample} data-testid="button-load-example">Load Example</button>
              </div>
              {error && <div className="alert-hero" role="alert" data-testid="status-decode-error">{error}</div>}
            </form>
          </div>
        </section>
      </div>

      <main className="content-wrapper">
        {!result && !error && !isDecoding && (
          <div className="result-block" style={{ borderTop: '1px solid var(--line)', paddingTop: '80px' }}>
            <div className="empty-box" data-testid="empty-decode-state">
              <div className="empty-icon"><Code2 size={48} strokeWidth={1.5} /></div>
              <h2 className="empty-title">Awaiting MLFB Input</h2>
              <p className="empty-desc">The dashboard will populate with the 16-position breakdown, electrical specifications, and wiring diagrams upon successful decode.</p>
            </div>
          </div>
        )}

        {isDecoding && (
          <div className="result-block" style={{ borderTop: '1px solid var(--line)', paddingTop: '80px' }}>
            <div className="empty-box" data-testid="loading-decode-state">
              <div className="empty-icon"><Database size={48} strokeWidth={1.5} /></div>
              <h2 className="empty-title">Compiling Specifications...</h2>
              <p className="empty-desc">Extracting positions and assembling SVG/PDF diagram schematics from local knowledge base.</p>
            </div>
          </div>
        )}

        {result && (
          <div className="result-block">
            <DecodeResultView 
              result={result} 
              copied={copied} 
              onCopy={copyResult} 
              onExport={exportResult} 
              diagramUrls={diagramUrls} 
            />
          </div>
        )}
      </main>
    </>
  );
}

function DecodeResultView({ result, copied, onCopy, onExport, diagramUrls }: { result: DecodeResult; copied: boolean; onCopy: () => void; onExport: () => void; diagramUrls?: string[] }) {
  const sourceRows = sourceFor(result);
  const [showSources, setShowSources] = useState(false);
  
  return (
    <>
      <section className="status-strip" data-testid="status-validation">
        <div className="status-left">
          <div className="status-label">{result.primary ? 'Configuration Decoded' : 'Primary Article Not Found'}</div>
          <div className="status-code" data-testid="text-normalized-mlfb">
            {result.formattedBase}{result.extras.length ? ` -Z${result.extras.join('+')}` : ''}
          </div>
        </div>
        <div className="status-right">
          <div className={`badge ${result.valid ? 'badge-success' : 'badge-error'}`}>
            {result.valid ? <CheckCircle2 size={16} strokeWidth={2.5} /> : <TriangleAlert size={16} strokeWidth={2.5} />}
            {result.valid ? 'VALIDATED' : 'REVIEW REQUIRED'}
          </div>
          <div className="action-group">
            <button className="btn-outline" onClick={onCopy} data-testid="button-copy-result">
              {copied ? 'Copied' : 'Copy Text'}
            </button>
            <button className="btn-outline" onClick={onExport} data-testid="button-export-result">
              JSON
            </button>
            <button className="btn-outline" onClick={() => window.print()} data-testid="button-print-result">
              Print
            </button>
          </div>
        </div>
      </section>

      {result.primary ? (
        <section className="spec-strip" data-testid="primary-electrical-data">
          <div className="spec-item">
            <div className="spec-val">{result.primary.rated_voltage_kv} <span style={{fontSize: '24px'}}>kV</span></div>
            <div className="spec-label">Rated Voltage</div>
          </div>
          <div className="spec-item">
            <div className="spec-val">{result.primary.rated_short_circuit_breaking_current_ka} <span style={{fontSize: '24px'}}>kA</span></div>
            <div className="spec-label">Short-Circuit Current</div>
          </div>
          <div className="spec-item">
            <div className="spec-val">{result.primary.rated_continuous_current_a} <span style={{fontSize: '24px'}}>A</span></div>
            <div className="spec-label">Continuous Current</div>
          </div>
          <div className="spec-item">
            <div className="spec-val">{result.primary.pole_center_distance_mm} <span style={{fontSize: '24px'}}>mm</span></div>
            <div className="spec-label">Pole-Center Distance</div>
          </div>
          <div className="spec-item">
            <div className="spec-val">{result.primary.vertical_distance_between_terminals_mm} <span style={{fontSize: '24px'}}>mm</span></div>
            <div className="spec-label">Terminal Distance</div>
          </div>
        </section>
      ) : (
        <div className="alert-box alert-error" data-testid="status-primary-unknown" style={{ marginBottom: '80px' }}>
          <TriangleAlert />
          <span><strong>Unknown primary article.</strong> Exact article prefix <code>{result.formattedBase.slice(0, 9)}</code> is absent from the local lookup table. Positions 6–8 are not guessed.</span>
        </div>
      )}

      <section className="details-section" data-testid="position-breakdown">
        <div className="section-head">
          <h2 className="section-title">Configuration Details</h2>
          <p className="section-subtitle">Extracted 16-position breakdown and component selection rules.</p>
        </div>
        
        <div className="details-grid">
          <div>
            <div className="pos-grid">
              {result.positionResults.map((item) => (
                <div className={`pos-card ${item.unknown ? 'unknown' : ''}`} key={item.position} data-testid={`position-${item.position.replace('–', '-')}`}>
                  <div className="pos-top">
                    <span className="pos-num">POS {item.position}</span>
                    <span className="pos-page">{item.sourcePage}</span>
                  </div>
                  <div className="pos-val">{item.value}</div>
                  <div className="pos-name">{item.label}</div>
                  <div className="pos-desc">{item.meaning}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="summary-col">
            <div className="summary-box" data-testid="description-panel">
              <h3>Configuration Summary</h3>
              <p className="summary-text" data-testid="text-human-description">{humanDescription(result)}</p>
            </div>

            <div className="summary-box" data-testid="validation-panel">
              <h3>Validation Checks</h3>
              <div style={{ marginTop: '16px' }}>
                {result.warnings.length ? (
                  result.warnings.map((warning, index) => (
                    <div className="alert-box alert-error" key={`${warning}-${index}`} data-testid={`warning-item-${index}`} style={{ marginBottom: '8px', padding: '12px' }}>
                      <TriangleAlert size={16} />
                      <span style={{ fontSize: '13px' }}>{warning}</span>
                    </div>
                  ))
                ) : (
                  <div className="alert-box alert-success" data-testid="status-all-clear" style={{ margin: 0, padding: '12px' }}>
                    <ShieldCheck size={16} />
                    <span style={{ fontSize: '13px' }}>No compatibility conflicts detected.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="summary-box" data-testid="order-codes-panel">
              <h3>Additional Order Codes</h3>
              <div className="order-list">
                {result.orderCodes.length || result.unknownOrderCodes.length ? (
                  <>
                    {result.orderCodes.map((item) => (
                      <div className="order-item" key={item.code} data-testid={`order-code-${item.code}`}>
                        <div className="order-top">
                          <span className="order-code">{item.code}</span>
                          <span className="order-tag">{item.category}</span>
                        </div>
                        <p className="order-desc">{item.description}</p>
                        {item.remarks && <div className="order-remark">Note: {item.remarks}</div>}
                      </div>
                    ))}
                    {result.unknownOrderCodes.map((code) => (
                      <div className="order-item" key={code} data-testid={`unknown-order-code-${code}`}>
                        <div className="order-top">
                          <span className="order-code">{code}</span>
                          <span className="order-tag" style={{ color: 'var(--accent-red)' }}>Unknown</span>
                        </div>
                        <p className="order-desc" style={{ color: 'var(--accent-red)' }}>No interpretation added.</p>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="summary-text" style={{ color: 'var(--text-muted)' }}>None supplied.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {diagramUrls && diagramUrls.length > 0 && (
        <section className="diagrams-section" data-testid="diagrams-panel">
          <div className="section-head">
            <h2 className="section-title">Generated Wiring Diagrams</h2>
            <p className="section-subtitle">Standardized circuit diagrams generated from the decoded SION configuration.</p>
          </div>
          <div className="diagram-grid">
            {diagramUrls.map((url, i) => (
              <div className="diagram-card" key={i}>
                <div className="diagram-head">
                  <span>WIRING DIAGRAM</span>
                  <span>PAGE {String(i + 1).padStart(2, '0')}</span>
                </div>
                <img className="diagram-img" src={url} alt={`Wiring diagram page ${i + 1}`} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="trace-card">
          <button 
            className="trace-btn" 
            onClick={() => setShowSources(!showSources)}
            data-testid="traceability-panel"
          >
            <span>Source Traceability</span>
            <span className="trace-icon">
              {showSources ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </span>
          </button>
          
          {showSources && (
            <div className="trace-content">
              {sourceRows.map((source) => (
                <div className="trace-item" key={source.label}>
                  <div className="trace-item-info">
                    <div className="trace-doc">{source.label}</div>
                    <div className="trace-pages">Relevant pages: <span>{source.page}</span></div>
                  </div>
                  <div>
                    <span className="trace-local">Local Reference</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function CatalogPage() {
  const [query, setQuery] = useState('');
  const [catalogView, setCatalogView] = useState<'z' | 'primary'>('z');
  
  const filtered = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return catalog.filter((item) => (!normalized || `${item.code} ${item.description} ${item.remarks ?? ''}`.toUpperCase().includes(normalized)));
  }, [query]);
  
  const filteredPrimary = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return primaryCatalog.filter((item) => !normalized || Object.values(item).join(' ').toUpperCase().includes(normalized));
  }, [query]);
  
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{catalogView === 'z' ? 'Z-Code Reference' : 'Primary Article Reference'}</h1>
        <p className="page-subtitle">{catalogView === 'z' ? `Viewing ${catalog.length} codes` : `Viewing ${primaryCatalog.length} records`}</p>
      </div>
      
      <div className="catalog-toolbar">
        <button className={`tab-btn ${catalogView === 'z' ? 'active' : ''}`} onClick={() => { setCatalogView('z'); setQuery(''); }}>Z / Additional Codes</button>
        <button className={`tab-btn ${catalogView === 'primary' ? 'active' : ''}`} onClick={() => { setCatalogView('primary'); setQuery(''); }}>Primary Articles</button>
      </div>
      
      <div style={{ marginBottom: '32px', maxWidth: '480px', position: 'relative' }}>
        <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input 
          style={{ width: '100%', height: '52px', padding: '0 16px 0 48px', borderRadius: '8px', border: '1px solid var(--line-strong)', outline: 'none', fontSize: '15px' }} 
          value={query} 
          onChange={(event) => setQuery(event.target.value)} 
          placeholder="Search codes or descriptions..." 
        />
      </div>
      
      <div className="data-table-wrap">
        {catalogView === 'z' && filtered.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Class</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.code}>
                  <td style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{item.code}</td>
                  <td>{item.description}</td>
                  <td><span style={{ color: 'var(--accent-siemens)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{item.category}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : catalogView === 'primary' && filteredPrimary.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Article</th>
                <th>Ur</th>
                <th>Isc</th>
                <th>Ir</th>
              </tr>
            </thead>
            <tbody>
              {filteredPrimary.map((item) => (
                <tr key={item.article_number}>
                  <td style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{item.article_number}</td>
                  <td>{item.rated_voltage_kv} kV</td>
                  <td>{item.rated_short_circuit_breaking_current_ka} kA</td>
                  <td>{item.rated_continuous_current_a} A</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-box" style={{ border: '1px solid var(--line)', background: 'var(--bg-surface)', borderRadius: '12px' }}>
            <div className="empty-icon"><Search size={32} /></div>
            <h2 className="empty-title" style={{ fontSize: '20px' }}>No Results Found</h2>
            <p className="empty-desc">No entries match <strong>{query}</strong>.</p>
          </div>
        )}
      </div>
    </>
  );
}

function SourcesPage() {
  const positions = [
    ['Article structure', 'p. 14'], ['Configuration example', 'p. 15'], ['Primary data lookup', 'pp. 16–24'],
    ['Release combination', 'p. 25'], ['Closing solenoid / first release', 'p. 26'], ['Second / third release', 'p. 27'],
    ['Installation options', 'p. 28'], ['Drive motor', 'p. 29'], ['Low-voltage interface', 'p. 30'], ['Language', 'p. 31'], ['Additional order codes', 'pp. 32–33'],
  ];
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Methodology & Sources</h1>
        <p className="page-subtitle">Local traceability for the decoded properties.</p>
      </div>
      
      <div className="details-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
        <div className="summary-box">
          <h3 style={{ fontSize: '20px', margin: '0 0 16px', color: 'var(--text-main)', fontWeight: 800 }}>Deterministic Validation</h3>
          <p className="summary-text" style={{ marginBottom: '16px' }}>Input is normalized to uppercase with whitespace removed. Hyphens, spaces and plus separators are accepted; <code>-Z</code> marks the boundary between the 16-position base article and additional order codes.</p>
          <p className="summary-text">The first eight positions are checked against the exact primary article lookup table. Position 6 is deliberately not decoded from a universal digit meaning because its dimensions depend on the voltage-level table and exact article row.</p>
        </div>
        <div className="summary-box">
          <h3 style={{ fontSize: '20px', margin: '0 0 24px', color: 'var(--text-main)', fontWeight: 800 }}>Catalog Source Map</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {positions.map(([label, page]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '16px', fontSize: '15px' }}>
                <span style={{ color: 'var(--text-body)', fontWeight: 500 }}>{label}</span>
                <span style={{ color: 'var(--accent-siemens)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{page}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Router() {
  return <ErrorBoundary resetKey="sion-decoder"><Switch><Route path="/" component={AppShell} /><Route component={AppShell} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;