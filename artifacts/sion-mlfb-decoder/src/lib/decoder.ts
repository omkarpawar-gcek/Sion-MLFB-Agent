import knowledge from '../knowledge/sion_3ae5_knowledge.json';
import primaryCsv from '../knowledge/primary_article_lookup.csv?raw';

export type ZCode = {
  code: string;
  description: string;
  remarks?: string;
  category: string;
};

export type PositionResult = {
  position: string;
  value: string;
  label: string;
  meaning: string;
  sourcePage: string;
  unknown?: boolean;
};

export type PrimaryRow = {
  article_number: string;
  rated_voltage_kv: string;
  rated_short_circuit_breaking_current_ka: string;
  pole_center_distance_mm: string;
  vertical_distance_between_terminals_mm: string;
  rated_continuous_current_a: string;
};

export type DecodeResult = {
  raw: string;
  base: string;
  formattedBase: string;
  extras: string[];
  positions: Record<string, string>;
  positionResults: PositionResult[];
  primary: PrimaryRow | null;
  orderCodes: ZCode[];
  unknownOrderCodes: string[];
  warnings: string[];
  valid: boolean;
};

const KB = knowledge as any;
const zCodes = KB.z_codes as ZCode[];

const parseCsv = (csv: string): PrimaryRow[] => {
  const rows = csv.trim().split(/\r?\n/);
  const headers = rows.shift()?.split(',') ?? [];
  return rows.map((line) => {
    const values = line.split(',');
    return headers.reduce((row, header, index) => {
      row[header as keyof PrimaryRow] = values[index] ?? '';
      return row;
    }, {} as PrimaryRow);
  });
};

const primaryRows = parseCsv(primaryCsv);

export const catalog = zCodes;
export const primaryCatalog = primaryRows;
export const exampleCode = '3AE5124-2AC90-6KN0-ZL1B+F30';

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function formatInput(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return '';

  const base = compact.slice(0, 16);
  const suffixWithMarker = compact.slice(16);
  const hasExplicitMarker = suffixWithMarker.startsWith('Z');
  const suffix = hasExplicitMarker ? suffixWithMarker.slice(1) : suffixWithMarker;

  let formattedBase = base.slice(0, 7);
  if (base.length > 7) formattedBase += `-${base.slice(7, 12)}`;
  if (base.length > 12) formattedBase += `-${base.slice(12, 16)}`;

  if (!hasExplicitMarker && !suffix) return formattedBase;

  const formattedSuffix = (suffix.match(/.{1,3}/g) ?? []).join('+');
  return `${formattedBase}-Z${formattedSuffix}`;
}

export function splitInput(raw: string): { base: string; extras: string[] } {
  const normalized = normalizeCode(raw).replace(/\+/g, ' ');
  const markerIndex = normalized.indexOf('-Z');
  if (markerIndex < 0) {
    return { base: normalized.replace(/-/g, ''), extras: [] };
  }
  const base = normalized.slice(0, markerIndex).replace(/-/g, '');
  let suffix = normalized.slice(markerIndex + 2).replace(/-/g, ' ');
  let extras = suffix.split(/[\s,;]+/).filter(Boolean);
  if (extras.length === 1 && extras[0].length > 3 && extras[0].length % 3 === 0) {
    extras = extras[0].match(/.{3}/g) ?? extras;
  }
  return { base, extras };
}

const primaryFor = (base: string): PrimaryRow | null => {
  const article = `${base.slice(0, 7)}-${base.slice(7, 8)}`;
  return primaryRows.find((row) => row.article_number.replace(/-/g, '') === article.replace(/-/g, '')) ?? null;
};

const sourcePageFor = (position: string): string => {
  if (['1', '2', '3', '4'].includes(position)) return 'p. 14';
  if (['5', '6', '7', '8'].includes(position)) return 'pp. 16–24';
  if (position === '9') return 'p. 25';
  if (position === '10') return 'p. 26';
  if (position === '11–12') return 'p. 27';
  if (position === '13') return 'p. 28';
  if (position === '14') return 'p. 29';
  if (position === '15') return 'p. 30';
  return 'p. 31';
};

const lookup = (position: string, value: string, label: string, meaning: string): PositionResult => ({
  position, value, label, meaning, sourcePage: sourcePageFor(position),
});

function knownOrUnknown(
  position: string,
  value: string,
  label: string,
  mapping: Record<string, string | number> | undefined,
  prefix = '',
): PositionResult {
  if (mapping && value in mapping) return lookup(position, value, label, `${prefix}${mapping[value]}`);
  return { ...lookup(position, value, label, `Unknown code: ${value}`), unknown: true };
}

export function decode(raw: string): DecodeResult {
  const { base, extras } = splitInput(raw);
  if (!base) throw new Error('Enter an article number to begin.');
  if (base.length !== 16) {
    throw new Error(`Expected 16 positions after removing separators; received ${base.length}.`);
  }
  if (!base.startsWith('3AE5')) throw new Error('This decoder is limited to Siemens SION 3AE5 article numbers.');

  const positions = Object.fromEntries([...base].map((char, index) => [String(index + 1), char]));
  const primary = primaryFor(base);
  const p = KB.position_codes;
  const positionResults: PositionResult[] = [
    lookup('1', positions['1'], 'Superior group', 'Switching devices'),
    lookup('2', positions['2'], 'Main group', 'Circuit-breaker'),
    lookup('3', positions['3'], 'Subgroup', 'Circuit-breaker type series'),
    lookup('4', positions['4'], 'Circuit-breaker version', 'SION 3AE5 circuit-breaker version'),
    knownOrUnknown('5', positions['5'], 'Rated voltage', p['5'].codes, 'Rated voltage: '),
  ];

  if (primary) {
    positionResults.push(
      lookup('6', positions['6'], 'Pole-center / terminal distance', `${primary.pole_center_distance_mm} mm pole-center; ${primary.vertical_distance_between_terminals_mm} mm terminal distance`),
      lookup('7', positions['7'], 'Short-circuit breaking current', `${primary.rated_short_circuit_breaking_current_ka} kA`),
      lookup('8', positions['8'], 'Continuous current', `${primary.rated_continuous_current_a} A`),
    );
  } else {
    ['6', '7', '8'].forEach((position) => {
      positionResults.push({
        ...lookup(position, positions[position], position === '6' ? 'Primary dimensions' : position === '7' ? 'Short-circuit current' : 'Continuous current', `Unknown code: ${positions[position]} — exact primary article not in catalog`),
        unknown: true,
      });
    });
  }

  positionResults.push(
    knownOrUnknown('9', positions['9'], 'Release combination', p['9'].codes),
    knownOrUnknown('10', positions['10'], 'Closing solenoid', p['10'].codes, 'Closing solenoid: '),
  );
  if (positions['11'] in p['11-12'].standard_code_map) {
    positionResults.push(lookup('11–12', `${positions['11']}${positions['12']}`, '1st / 2nd release voltage', p['11-12'].standard_code_map[positions['11']]));
  } else if (positions['11'] === '9') {
    positionResults.push(lookup('11–12', `${positions['11']}${positions['12']}`, '1st / 2nd release voltage', 'Special release voltage; a descriptive order code is required.'));
  } else {
    positionResults.push({ ...lookup('11–12', `${positions['11']}${positions['12']}`, '1st / 2nd release voltage', `Unknown code: ${positions['11']}${positions['12']}`), unknown: true });
  }
  positionResults.push(
    knownOrUnknown('13', positions['13'], 'Installation options', p['13'].codes),
    knownOrUnknown('14', positions['14'], 'Drive motor voltage', p['14'].codes, 'Drive motor: '),
    knownOrUnknown('15', positions['15'], 'Low-voltage interface', p['15'].codes),
    knownOrUnknown('16', positions['16'], 'Language', p['16'].codes),
  );

  const zByCode = new Map(zCodes.map((item) => [item.code, item]));
  const orderCodes = extras.filter((code) => zByCode.has(code)).map((code) => zByCode.get(code) as ZCode);
  const unknownOrderCodes = extras.filter((code) => !zByCode.has(code));
  const warnings: string[] = [];
  if (!primary) warnings.push('Exact primary article number was not found in the catalog lookup table; positions 6–8 are not guessed.');
  if (unknownOrderCodes.length) unknownOrderCodes.forEach((code) => warnings.push(`Unknown order code: ${code}`));
  const codeSet = new Set(extras);
  if (codeSet.has('A29') && codeSet.has('A30')) warnings.push('INVALID: A29 and A30 are mutually exclusive.');
  if (codeSet.has('A47') && codeSet.has('J60')) warnings.push('INVALID: A47 and J60 are mutually exclusive.');
  if (codeSet.has('W88') && !codeSet.has('D93')) warnings.push('INVALID/INCOMPLETE: W88 requires D93.');
  if (codeSet.has('W89') && !codeSet.has('D93')) warnings.push('INVALID/INCOMPLETE: W89 requires D93.');
  if ((codeSet.has('M04') || codeSet.has('M05')) && !codeSet.has('W88') && !codeSet.has('W89')) warnings.push('INVALID/INCOMPLETE: M04/M05 require W88 or W89.');
  if ((codeSet.has('M04') || codeSet.has('M05')) && (codeSet.has('A29') || codeSet.has('A30'))) warnings.push('INVALID: M04/M05 are not compatible with A29 or A30.');
  if (codeSet.has('S49') && positions['13'] !== '0') warnings.push('INVALID: S49 is only possible for fixed mounting.');
  const harnessCodes = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B17'];
  if (harnessCodes.some((code) => codeSet.has(code)) && positions['15'] !== 'X') warnings.push('INVALID/INCOMPLETE: selected cable-harness options require position 15 = X.');

  return {
    raw,
    base,
    formattedBase: `${base.slice(0, 7)}-${base.slice(7, 8)}${base.slice(8, 12)}-${base.slice(12)}`,
    extras,
    positions,
    positionResults,
    primary,
    orderCodes,
    unknownOrderCodes,
    warnings,
    valid: !warnings.some((warning) => warning.startsWith('INVALID')),
  };
}

export function humanDescription(result: DecodeResult): string {
  if (!result.primary) return 'A Siemens SION 3AE5 configuration with an unlisted primary article. Electrical dimensions and ratings are intentionally not inferred.';
  const p = result.primary;
  const extras = result.orderCodes.map((item) => `${item.code} (${item.description.toLowerCase()})`).join('; ');
  const tail = extras ? ` Additional order codes: ${extras}.` : '';
  return `Siemens SION 3AE5 vacuum circuit-breaker, ${p.rated_voltage_kv} kV, ${p.rated_short_circuit_breaking_current_ka} kA, ${p.rated_continuous_current_a} A, ${p.pole_center_distance_mm} mm pole-center distance and ${p.vertical_distance_between_terminals_mm} mm vertical terminal distance.${tail}`;
}

export function sourceFor(result: DecodeResult): { label: string; page: string }[] {
  const sources = new Map<string, string>();
  result.positionResults.forEach((item) => sources.set(item.label, item.sourcePage));
  if (result.orderCodes.length) sources.set('Additional order codes', 'pp. 32–33');
  return [...sources].map(([label, page]) => ({ label, page }));
}