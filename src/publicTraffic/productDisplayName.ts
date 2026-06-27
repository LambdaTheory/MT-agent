import { readFile } from 'node:fs/promises';
import type { PublicTrafficProductDataRow } from './types.js';

export type ProductNameMap = Record<string, string>;

const NOISE_TOKENS = ['一天起租', '1天起租', '1天', '70天', '芝麻免押', '租赁', '演唱会', '出游', '日常记录', '出片神器', '配置可选', '游戏娱乐', '学习办公', '顺丰包邮', '全网通5G智能手机', '平板电脑', '网红同款', '数码相机', '冷白皮', 'ZFB'];
const BRAND_PREFIXES = ['Apple 苹果', '苹果/Apple'];
const FALLBACK_LIMIT = 24;
const MAPPED_LIMIT = 24;

export function internalProductId(displayProductId: string): string {
  return displayProductId.replace(/^端内ID\s*/, '').trim();
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function formatCanonRfLens(mountRaw: string, modelRaw: string): string {
  const mount = mountRaw.toUpperCase() === 'RFS' ? 'RF-S' : mountRaw.toUpperCase();
  const compact = modelRaw.toLowerCase().replace(/\s+/g, '');
  if (compact === '100-400' || compact === '100-400mm') return `${mount} 100-400mm`;
  if (compact === '50f1.8' || compact === '50mmf1.8') return `${mount} 50mm F1.8`;
  if (compact === '18-150' || compact === '18-150mm') return `${mount} 18-150mm`;
  return `${mount} ${modelRaw.replace(/\s+/g, ' ')}`.trim();
}

function formatIxusModel(modelRaw: string): string {
  return modelRaw.toUpperCase().replace(/\s+/g, '');
}

function compactModelName(name: string): string | null {
  const ulike = name.match(/\bUlike\s*Air\s*3\b/i);
  if (ulike) return 'Ulike Air 3';

  const seayeo = name.match(/\bSEAYEO\b.*大排灯美容仪/u);
  if (seayeo) return 'SEAYEO 大排灯美容仪';

  const canonRfLens = name.match(/佳能\s*(RF-S|RF)\s*(100-400mm|50mm\s*F1\.8|18-150mm)/i);
  if (canonRfLens) return `佳能 ${canonRfLens[1].toUpperCase()} ${canonRfLens[2].replace(/\s+/g, ' ')} 镜头`;

  const canonRfLensBare = name.match(/\b(?:canon\s*)?(rf-s|rfs|rf)\s*(100-400(?:mm)?|50(?:mm)?\s*f1\.8|18-150(?:mm)?)/i);
  if (canonRfLensBare) return `佳能 ${formatCanonRfLens(canonRfLensBare[1], canonRfLensBare[2])} 镜头`;

  const vivoLens = name.match(/vivo\s*蔡司增距镜/i);
  if (vivoLens) return 'vivo 蔡司增距镜';

  const tripod = name.match(/富图宝\s*(FY8[23]0)\s*三脚架/i);
  if (tripod) return `富图宝 ${tripod[1].toUpperCase()} 三脚架`;

  const djiPocket = name.match(/(?:大疆|DJI)\s*(?:O\s*mo|Osmo)?\s*Pocket\s*([34])/i);
  if (djiPocket) return `大疆 Pocket ${djiPocket[1]}`;

  const djiPocketTypo = name.match(/(?:大疆|DJI)\s*pocke[t]?\s*([34])/i);
  if (djiPocketTypo) return `大疆 Pocket ${djiPocketTypo[1]}`;

  const djiPocketBare = name.match(/\bpocket\s*([34])\b/i);
  if (djiPocketBare) return `大疆 Pocket ${djiPocketBare[1]}`;

  const djiAction = name.match(/(?:大疆|DJI)\s*(?:Osmo\s*)?Action\s*([456])\s*(Pro)?/i);
  if (djiAction) return ['大疆 Action', djiAction[1], djiAction[2] ? 'Pro' : ''].filter(Boolean).join(' ');

  const djiActionBare = name.match(/\b(?:dji\s*)?action\s*6\b/i);
  if (djiActionBare) return '大疆 Action 6';

  const djiMobile = name.match(/(?:大疆|DJI)\s*(?:Osmo\s*)?Mobile\s*7\s*P/i);
  if (djiMobile) return '大疆 Osmo Mobile 7P';

  const djiNano = name.match(/(?:大疆|DJI)\s*(?:(?:O\s*mo|Osmo)\s*)?Nano/i);
  if (djiNano) return '大疆 Osmo Nano';

  const insta = name.match(/(?:影石\s*)?Insta360\s*(GO\s*3S|Ace\s*Pro\s*2?)/i);
  if (insta) return `影石 Insta360 ${insta[1].replace(/\s+/g, ' ').replace(/Ace Pro2/i, 'Ace Pro 2').replace(/Ace Pro$/i, 'Ace Pro')}`;

  const fujiInstax = name.match(/富士\s*instax\s*(mini|SQUARE|wide)\s*(link\s*[23]|EVO|LiPlay|SQ(?:1|20|40)|(?:11|12|40|90|99|300|400))/i);
  if (fujiInstax) return `富士 instax ${fujiInstax[1]} ${fujiInstax[2].replace(/\s+/g, ' ')}`;

  const fujiInstaxBare = name.match(/\binstax\s*(mini|square|wide)\s*(link\s*[23]|evo|liplay|se|sq(?:1|20|40)|(?:11|12|40|90|99|300|400))\b/i);
  if (fujiInstaxBare) return `富士 instax ${fujiInstaxBare[1]} ${fujiInstaxBare[2].replace(/\s+/g, ' ')}`;

  const fujiMiniLink = name.match(/\bmini\s*link\s*([23])\b/i);
  if (fujiMiniLink) return `富士 instax mini Link ${fujiMiniLink[1]}`;

  const fujiMiniSe = name.match(/\bmini\s*se\b/i);
  if (fujiMiniSe) return '富士 instax mini SE';

  const fujiSquareBare = name.match(/\bsq(1|20|40)\b/i);
  if (fujiSquareBare) return `富士 instax SQUARE SQ${fujiSquareBare[1]}`;

  const fujiLiPlay = name.match(/富士\s*mini\s*LiPlay/i);
  if (fujiLiPlay) return '富士 mini LiPlay';

  const fujiLiPlayBare = name.match(/\bmini[-\s]*LiPlay\b/i);
  if (fujiLiPlayBare) return '富士 mini LiPlay';

  const fujiXHalf = name.match(/富士\s*X[-\s]?half/i);
  if (fujiXHalf) return '富士 X-half';

  const sonyZv = name.match(/索尼\s*ZV-?1\b/i);
  if (sonyZv) return '索尼 ZV-1';

  const sonyRx = name.match(/索尼\s*RX10\s*M?4\b/i);
  if (sonyRx) return '索尼 RX10M4';

  const sonyRxBare = name.match(/\bRX10\s*M?4\b/i);
  if (sonyRxBare) return '索尼 RX10M4';

  const panasonic = name.match(/松下\s*(ZS99|ZS220D|FZ80D|ZS80D)\b/i);
  if (panasonic) return `松下 ${panasonic[1].toUpperCase()}`;

  const nikon = name.match(/尼康\s*(P1000|A900|B700)\b/i);
  if (nikon) return `尼康 ${nikon[1].toUpperCase()}`;

  const canonEos = name.match(/佳能\s*EOS\s*R50\b/i);
  if (canonEos) return '佳能 EOS R50';

  const canonIxus130 = name.match(/佳能\s*IXUS\s*130\b/i);
  if (canonIxus130) return '佳能 IXUS 130';

  const canonIxusSeries = name.match(/佳能\s*IXUS\s*系列/i);
  if (canonIxusSeries) return '佳能 IXUS CCD';

  const canonIxusBare = name.match(/\b(?:canon\s*)?ixus\s*([0-9]{2,3}\s*(?:is|hs)?)\b/i);
  if (canonIxusBare) return `佳能 IXUS ${formatIxusModel(canonIxusBare[1])}`;

  const canon = name.match(/佳能\s*((?:G7X|SX|CP)\s*\d+[A-Z]*|G\s*\d+)/i);
  if (canon) return `佳能 ${canon[1].replace(/\s+/g, '').toUpperCase().replace(/^(SX\d+)HS$/, '$1 HS')}`;

  const iphone = name.match(/\biPhone\s*(\d+)\s*(Pro|Plus|Air|mini)?\s*(Max)?/i);
  if (iphone) return ['iPhone', iphone[1], iphone[2] ? `${iphone[2][0].toUpperCase()}${iphone[2].slice(1).toLowerCase()}` : '', iphone[3] ? 'Max' : ''].filter(Boolean).join(' ');

  const ipad = name.match(/\biPad\s*(mini|Air|Pro)?\s*(\d*)\s*(\d{4}款)?/i);
  if (ipad) return ['iPad', ipad[1] ? `${ipad[1][0].toUpperCase()}${ipad[1].slice(1).toLowerCase()}` : '', ipad[2], ipad[3]].filter(Boolean).join(' ').replace('Mini ', 'mini');

  const vivo = name.match(/\bvivo\s+X\s*(\d+)\s+Ultra\b/i);
  if (vivo) return `vivo X${vivo[1]} Ultra`;

  const vivoBare = name.match(/\bX\s*(\d+)\s*Ultra\b/i);
  if (vivoBare) return `vivo X${vivoBare[1]} Ultra`;

  const vivoPro = name.match(/\bvivo\s*X\s*(\d+)\s*Pro\b/i);
  if (vivoPro) return `vivo X${vivoPro[1]} Pro`;

  const ipodTouch = name.match(/\bipod\s*touch\s*(\d+)\b/i);
  if (ipodTouch) return `iPod touch ${ipodTouch[1]}`;

  const amiroMask = name.match(/\bAMIRO\b.*\bABM502\b|\bABM502\b/i);
  if (amiroMask) return 'AMIRO ABM502';

  return null;
}

export function canonicalProductShortName(productName: string): string {
  let name = productName.trim();
  name = name.replace(/in\s+tax/gi, 'instax').replace(/in\s+ta360/gi, 'Insta360');
  for (const prefix of BRAND_PREFIXES) name = name.replaceAll(prefix, ' ');
  for (const token of NOISE_TOKENS) name = name.replaceAll(token, ' ');
  name = name.replace(/\bmax\b/gi, 'Max').replace(/\s+/g, ' ').trim();
  return compactModelName(name) ?? name;
}

export function resolveProductDisplayName(row: PublicTrafficProductDataRow, productNameMap: ProductNameMap = {}): string {
  const mappedName = productNameMap[internalProductId(row.displayProductId)]?.trim();
  if (mappedName) return truncate(mappedName, MAPPED_LIMIT);

  const cleaned = canonicalProductShortName(row.productName);
  if (cleaned) return truncate(cleaned, FALLBACK_LIMIT);

  return row.displayProductId;
}

export async function loadProductNameMap(path: string, warn: (message: string) => void = () => undefined): Promise<ProductNameMap> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');

    const mapping: ProductNameMap = {};
    for (const [id, name] of Object.entries(parsed)) {
      if (typeof name !== 'string') continue;
      const trimmed = name.trim();
      if (trimmed) mapping[id] = trimmed;
    }
    return mapping;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
    warn(`商品短名映射加载失败: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}
