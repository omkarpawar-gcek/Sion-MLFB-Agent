import { useMemo, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  BookOpen,
  CheckCircle2,
  ClipboardCopy,
  Code2,
  Database,
  Download,
  Gauge,
  Info,
  LayoutDashboard,
  Library,
  Menu,
  Printer,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import {
  catalog,
  decode,
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
  const [mobileRail, setMobileRail] = useState(false);

  return (
    <div className="app-shell">
      <aside className={`rail ${mobileRail ? 'mobile-open' : ''}`} data-testid="navigation-sidebar">
        <div className="brand" data-testid="brand-sion-decoder">
          <div className="brand-mark">3AE5</div>
          <div>
            <div className="brand-title">SION / MLFB</div>
            <div className="brand-subtitle">DECODER WORKBENCH</div>
          </div>
        </div>
        <div className="rail-rule" />
        <div className="nav-label">Workspace</div>
        <nav className="nav-list" aria-label="Primary navigation">
          <button className={`nav-button ${tab === 'decode' ? 'active' : ''}`} onClick={() => { setTab('decode'); setMobileRail(false); }} data-testid="nav-decode">
            <LayoutDashboard /><span>Decode article</span>
          </button>
          <button className={`nav-button ${tab === 'catalog' ? 'active' : ''}`} onClick={() => { setTab('catalog'); setMobileRail(false); }} data-testid="nav-catalog">
            <Library /><span>Z-code catalog</span>
          </button>
          <button className={`nav-button ${tab === 'sources' ? 'active' : ''}`} onClick={() => { setTab('sources'); setMobileRail(false); }} data-testid="nav-sources">
            <BookOpen /><span>Source notes</span>
          </button>
        </nav>
        <div className="rail-bottom">
          <div className="rail-bottom-label">Local knowledge base</div>
          <p><strong>HG 11.02 · 2026</strong><br />Deterministic lookup only. No inferred meanings.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileRail((value) => !value)} aria-label="Toggle navigation" data-testid="button-toggle-navigation">
            <Menu />
          </button>
          <div className="topbar-context"><Database /> <span>Siemens SION vacuum circuit-breaker · 3AE5</span></div>
          <div className="topbar-status"><span className="status-dot" /> LOCAL DATASET READY</div>
        </header>
        <main className="content">
          {tab === 'decode' && <DecoderPage />}
          {tab === 'catalog' && <CatalogPage />}
          {tab === 'sources' && <SourcesPage />}
        </main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, meta }: { eyebrow: string; title: string; description: string; meta: string }) {
  return (
    <div className="page-heading">
      <div className="page-heading-copy">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-meta">{meta}</div>
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
      const diagData = await diagRes.json();
      if (diagRes.ok && diagData.output_pages) {
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

  const clear = () => {
    setInput('');
    setError('');
    setResult(undefined);
    setCopied(false);
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
      <PageHeading
        eyebrow="Engineering workbench / deterministic decode"
        title="Decode an article number."
        description="Trace every position of a Siemens SION 3AE5 MLFB to the local catalog. Unknown segments stay unknown."
        meta="KB REVISION  ·  HG 11.02 / 2026"
      />
      <section className="panel decode-panel" data-testid="decoder-input-panel">
        <div className="panel-head">
          <div>
            <div className="panel-title"><Code2 /> Article number input</div>
            <div className="panel-kicker">Type the code continuously. MLFB hyphens, the <code>-Z</code> boundary and Z-code <code>+</code> separators are added automatically.</div>
          </div>
          {input && <button className="button-quiet" onClick={clear} data-testid="button-clear-input"><X /> Clear</button>}
        </div>
        <form onSubmit={submit}>
          <div className="input-line">
            <input
              className="code-input"
              value={input}
              onChange={(event) => setInput(formatInput(event.target.value))}
              placeholder="3AE51242AC906KN0L1BF30"
              aria-label="MLFB or article number"
              spellCheck={false}
              data-testid="input-mlfb"
            />
            <button className="button-primary" type="submit" disabled={!input.trim() || isDecoding} data-testid="button-decode">
              <Zap /> {isDecoding ? 'Reading catalog…' : 'Decode article'}
            </button>
          </div>
        </form>
        <div className="example-line">
          <span>Known configuration example</span>
          <code>{exampleCode}</code>
          <button className="link-button" onClick={loadExample} data-testid="button-load-example">Load example</button>
        </div>
        {error && <div className="alert alert-error" role="alert" data-testid="status-decode-error"><TriangleAlert /> <span>{error}</span></div>}
      </section>

      {!result && !error && !isDecoding && <section className="panel empty-state" data-testid="empty-decode-state"><div><div className="empty-glyph"><Gauge /></div><h2>Awaiting a valid article number</h2><p>Start with the supplied configuration example or enter a 16-position SION 3AE5 article number. The decoder will show the catalog evidence behind each result.</p></div></section>}
      {isDecoding && <section className="panel empty-state" data-testid="loading-decode-state"><div><div className="empty-glyph"><Database /></div><h2>Reading catalog and generating diagrams</h2><p>Checking article structure, compiling PDFs and assembling schematic macros.</p></div></section>}
      {result && <DecodeResultView result={result} copied={copied} onCopy={copyResult} onExport={exportResult} diagramUrls={diagramUrls} />}
    </>
  );
}

function DecodeResultView({ result, copied, onCopy, onExport, diagramUrls }: { result: DecodeResult; copied: boolean; onCopy: () => void; onExport: () => void; diagramUrls?: string[] }) {
  const sourceRows = sourceFor(result);
  return (
    <div className="result-stack" data-testid="decode-result">
      <section className={`result-banner ${result.valid ? '' : 'invalid'}`} data-testid="status-validation">
        <div>
          <div className="eyebrow">Decoded configuration</div>
          <h2>{result.primary ? 'SION 3AE5 · catalog match' : 'SION 3AE5 · primary article not found'}</h2>
          <div className="result-code" data-testid="text-normalized-mlfb">{result.formattedBase}{result.extras.length ? ` -Z${result.extras.join('+')}` : ''}</div>
        </div>
        <div className="result-actions">
          <button className="button-secondary" onClick={onCopy} data-testid="button-copy-result"><ClipboardCopy /> {copied ? 'Copied' : 'Copy result'}</button>
          <button className="button-secondary" onClick={onExport} data-testid="button-export-result"><Download /> Export JSON</button>
          <button className="button-secondary" onClick={() => window.print()} data-testid="button-print-result"><Printer /> Print</button>
        </div>
        <div className={`validation-badge ${result.valid ? '' : 'invalid'}`}>
          {result.valid ? <CheckCircle2 /> : <TriangleAlert />}
          {result.valid ? 'VALIDATED AGAINST KB' : 'REVIEW REQUIRED'}
        </div>
      </section>

      {result.primary && <div className="metrics" data-testid="primary-electrical-data">
        <Metric label="Rated voltage" value={`${result.primary.rated_voltage_kv} kV`} note="50/60 Hz" accent />
        <Metric label="Short-circuit breaking" value={`${result.primary.rated_short_circuit_breaking_current_ka} kA`} note="rated Isc" />
        <Metric label="Continuous current" value={`${result.primary.rated_continuous_current_a} A`} note="rated Ir" />
        <Metric label="Pole-center distance" value={`${result.primary.pole_center_distance_mm} mm`} note={`${result.primary.vertical_distance_between_terminals_mm} mm terminal distance`} />
      </div>}

      {!result.primary && <div className="alert alert-error" data-testid="status-primary-unknown"><TriangleAlert /><span><strong>Unknown primary article.</strong> Exact article prefix <code>{result.formattedBase.slice(0, 9)}</code> is absent from the local lookup table. Positions 6–8 are not guessed.</span></div>}

      <div className="two-col">
        <section className="panel section-panel" data-testid="position-breakdown">
          <div className="section-heading"><h2>Position-by-position breakdown</h2><span>16 POSITIONS · {result.positionResults.filter((item) => !item.unknown).length} RESOLVED</span></div>
          <div className="position-grid">
            {result.positionResults.map((item) => <PositionCell key={item.position} item={item} />)}
          </div>
        </section>
        <div className="right-column">
          <section className="panel section-panel" data-testid="validation-panel">
            <div className="section-heading"><h2>Validation & warnings</h2><span>{result.warnings.length} FLAG{result.warnings.length === 1 ? '' : 'S'}</span></div>
            {result.warnings.length ? <div className="warning-list">{result.warnings.map((warning, index) => <div className="warning-item" key={`${warning}-${index}`} data-testid={`warning-item-${index}`}><TriangleAlert /><span>{warning}</span></div>)}</div> : <div className="all-clear" data-testid="status-all-clear"><ShieldCheck /><span>No compatibility conflicts detected in the supplied codes.</span></div>}
          </section>
          <section className="panel section-panel" style={{ marginTop: 18 }} data-testid="description-panel">
            <div className="description-box"><h3>Human-readable description</h3><p data-testid="text-human-description">{humanDescription(result)}</p></div>
          </section>
        </div>
      </div>

      <div className="two-col">
        <section className="panel section-panel" data-testid="order-codes-panel">
          <div className="section-heading"><h2>Z / additional order codes</h2><span>{result.extras.length} SUPPLIED</span></div>
          {result.orderCodes.length || result.unknownOrderCodes.length ? <div className="order-list">
            {result.orderCodes.map((item) => <OrderItem key={item.code} item={item} />)}
            {result.unknownOrderCodes.map((code) => <div className="order-item" key={code} data-testid={`unknown-order-code-${code}`}><div className="order-item-head"><span className="order-code">{code}</span><span className="order-tag" style={{ color: 'var(--red)' }}>Unknown code</span></div><p className="order-description">No meaning is present in the local catalog for the exact segment <strong>{code}</strong>. No interpretation has been added.</p></div>)}
          </div> : <div className="no-orders" data-testid="empty-order-codes">No additional order codes supplied.</div>}
        </section>
        <section className="panel section-panel" data-testid="traceability-panel">
          <div className="section-heading"><h2>Source traceability</h2><span>LOCAL REFERENCES</span></div>
          <div className="source-list">{sourceRows.map((source) => <div className="source-row" key={source.label}><span>{source.label}</span><span className="source-page">{source.page}</span></div>)}</div>
          <div className="alert alert-info" style={{ marginTop: 14 }}><Info /><span>Interpretations are from the local SION 3AE5 knowledge base. This starter is not a certification or ordering authority.</span></div>
        </section>
      </div>

      {diagramUrls && diagramUrls.length > 0 && (
        <section className="panel section-panel" data-testid="diagrams-panel" style={{ marginTop: 18 }}>
          <div className="section-heading"><h2>Generated Wiring Diagrams</h2><span>{diagramUrls.length} PAGE{diagramUrls.length === 1 ? '' : 'S'}</span></div>
          <div className="diagram-list" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {diagramUrls.map((url, i) => (
              <img key={i} src={url} alt={`Wiring diagram page ${i + 1}`} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: '4px' }} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return <div className={`metric ${accent ? 'accent' : ''}`} data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>;
}

function PositionCell({ item }: { item: PositionResult }) {
  return <div className={`position-cell ${item.unknown ? 'unknown' : ''}`} data-testid={`position-${item.position.replace('–', '-')}`}>
    <div className="position-num"><span>POS {item.position}</span><span>{item.sourcePage}</span></div>
    <div className="position-value">{item.value}</div>
    <div className={`position-meaning ${item.unknown ? 'unknown-text' : ''}`}><strong>{item.label}</strong><br />{item.meaning}</div>
  </div>;
}

function OrderItem({ item }: { item: ZCode }) {
  return <div className="order-item" data-testid={`order-code-${item.code}`}><div className="order-item-head"><span className="order-code">{item.code}</span><span className="order-tag">{item.category === 'special order code' ? 'Special order' : 'Catalogued'}</span></div><p className="order-description">{item.description}</p>{item.remarks && <p className="order-remarks"><strong>Catalog note:</strong> {item.remarks}</p>}</div>;
}

function CatalogPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [catalogView, setCatalogView] = useState<'z' | 'primary'>('z');
  const categories = useMemo(() => ['all', ...Array.from(new Set(catalog.map((item) => item.category)))], []);
  const filtered = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return catalog.filter((item) => (category === 'all' || item.category === category) && (!normalized || `${item.code} ${item.description} ${item.remarks ?? ''}`.toUpperCase().includes(normalized)));
  }, [category, query]);
  const filteredPrimary = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return primaryCatalog.filter((item) => !normalized || Object.values(item).join(' ').toUpperCase().includes(normalized));
  }, [query]);
  return (
    <>
      <PageHeading eyebrow="Reference catalog / searchable local source" title={catalogView === 'z' ? 'Z-code catalog.' : 'Primary article catalog.'} description={catalogView === 'z' ? 'Browse every additional-order code loaded from the SION 3AE5 source. Search exact codes, descriptions or catalog remarks.' : 'Search the exact 16-position article prefixes and primary electrical data extracted from the source tables.'} meta={catalogView === 'z' ? `${catalog.length} LOADED CODES` : `${primaryCatalog.length} ARTICLE ROWS`} />
      <div className="catalog-switcher" role="tablist" aria-label="Catalog source">
        <button className={`catalog-switch ${catalogView === 'z' ? 'active' : ''}`} onClick={() => { setCatalogView('z'); setQuery(''); }} role="tab" aria-selected={catalogView === 'z'} data-testid="button-catalog-zcodes"><Code2 /> Z / additional codes <span>{catalog.length}</span></button>
        <button className={`catalog-switch ${catalogView === 'primary' ? 'active' : ''}`} onClick={() => { setCatalogView('primary'); setQuery(''); }} role="tab" aria-selected={catalogView === 'primary'} data-testid="button-catalog-primary"><Gauge /> Primary articles <span>{primaryCatalog.length}</span></button>
      </div>
      <div className="catalog-toolbar">
        <div className="catalog-search-wrap"><Search /><input className="catalog-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code or meaning" aria-label="Search catalog" data-testid="input-catalog-search" /></div>
        {catalogView === 'z' && <select className="filter-select" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter catalog category" data-testid="select-catalog-category">{categories.map((item) => <option value={item} key={item}>{item === 'all' ? 'All categories' : item}</option>)}</select>}
      </div>
      <div className="table-count" style={{ marginBottom: 9 }} data-testid="text-catalog-count">{catalogView === 'z' ? `${filtered.length} of ${catalog.length} codes shown` : `${filteredPrimary.length} of ${primaryCatalog.length} article rows shown`}</div>
      <section className="catalog-table-wrap" data-testid="catalog-table">
        {catalogView === 'z' && filtered.length ? <table className="catalog-table"><thead><tr><th>Code</th><th>Description</th><th>Catalog remarks / compatibility</th><th>Class</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.code} data-testid={`catalog-row-${item.code}`}><td><span className="catalog-code">{item.code}</span></td><td>{item.description}</td><td className="catalog-remarks">{item.remarks ?? 'No additional remark supplied.'}</td><td><span className="order-tag">{item.category}</span></td></tr>)}</tbody></table> : catalogView === 'primary' && filteredPrimary.length ? <table className="catalog-table"><thead><tr><th>Article number</th><th>Ur</th><th>Isc</th><th>PCD</th><th>VDT</th><th>Ir</th></tr></thead><tbody>{filteredPrimary.map((item) => <tr key={item.article_number} data-testid={`catalog-row-${item.article_number}`}><td><span className="catalog-code">{item.article_number}</span></td><td>{item.rated_voltage_kv} kV</td><td>{item.rated_short_circuit_breaking_current_ka} kA</td><td>{item.pole_center_distance_mm} mm</td><td>{item.vertical_distance_between_terminals_mm} mm</td><td>{item.rated_continuous_current_a} A</td></tr>)}</tbody></table> : <div className="catalog-empty" data-testid="empty-catalog-state"><Search style={{ margin: '0 auto 10px' }} /><div>No catalog entries match <strong>{query}</strong>.</div></div>}
      </section>
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
      <PageHeading eyebrow="Audit notes / source boundaries" title="Trace the evidence." description="The decoder is intentionally narrow: local source tables are authoritative, and missing data is surfaced rather than inferred." meta="SOURCE MAP · 14–33" />
      <div className="source-page-content">
        <section className="panel source-card" data-testid="source-method-card"><h2>Deterministic by design</h2><p>Input is normalized to uppercase with whitespace removed. Hyphens, spaces and plus separators are accepted; <code>-Z</code> marks the boundary between the 16-position base article and additional order codes.</p><p>The first eight positions are checked against the exact primary article lookup table. Position 6 is deliberately not decoded from a universal digit meaning because its dimensions depend on the voltage-level table and exact article row.</p><p>For a missing row or code, the workbench shows the exact segment and says <strong>Unknown code</strong>. It does not use a language model or a fallback guess.</p></section>
        <section className="panel source-card" data-testid="source-map-card"><h2>Catalog source map</h2><div className="source-matrix">{positions.map(([label, page]) => <div className="source-matrix-row" key={label}><span>{label}</span><span>{page}</span></div>)}</div></section>
        <section className="panel source-card" data-testid="validation-rules-card"><h2>Compatibility checks included</h2><p>The local validation layer explicitly checks:</p><div className="warning-list"><div className="warning-item"><TriangleAlert /><span>A29 vs A30; A47 vs J60</span></div><div className="warning-item"><TriangleAlert /><span>W88 / W89 require D93</span></div><div className="warning-item"><TriangleAlert /><span>M04 / M05 require W88 or W89</span></div><div className="warning-item"><TriangleAlert /><span>S49 requires fixed mounting; B01–B09 / B17 require position 15 = X</span></div></div></section>
        <section className="panel source-card" data-testid="source-limitations-card"><h2>Limitations</h2><p>This starter knowledge base is derived from <strong>Siemens HG 11.02 · 2026</strong>. It is not a certification or ordering authority. Some release-combination rows and configuration-dependent options require consultation of the full source catalog.</p><div className="all-clear"><ShieldCheck /><span>Traceability is retained per decoded position and for every catalogued Z-code.</span></div></section>
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