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

function compactModelName(name: string): string | null {
  const canonRfLens = name.match(/佳能\s*(RF-S|RF)\s*(100-400mm|50mm\s*F1\.8|18-150mm)/i);
  if (canonRfLens) return `佳能 ${canonRfLens[1].toUpperCase()} ${canonRfLens[2].replace(/\s+/g, ' ')} 镜头`;

  const vivoLens = name.match(/vivo\s*蔡司增距镜/i);
  if (vivoLens) return 'vivo 蔡司增距镜';

  const tripod = name.match(/富图宝\s*(FY8[23]0)\s*三脚架/i);
  if (tripod) return `富图宝 ${tripod[1].toUpperCase()} 三脚架`;

  const djiPocket = name.match(/(?:大疆|DJI)\s*(?:O\s*mo|Osmo)?\s*Pocket\s*([34])/i);
  if (djiPocket) return `大疆 Pocket ${djiPocket[1]}`;

  const djiAction = name.match(/(?:大疆|DJI)\s*(?:Osmo\s*)?Action\s*([45])\s*(Pro)?/i);
  if (djiAction) return ['大疆 Action', djiAction[1], djiAction[2] ? 'Pro' : ''].filter(Boolean).join(' ');

  const djiMobile = name.match(/(?:大疆|DJI)\s*(?:Osmo\s*)?Mobile\s*7\s*P/i);
  if (djiMobile) return '大疆 Osmo Mobile 7P';

  const djiNano = name.match(/(?:大疆|DJI)\s*(?:(?:O\s*mo|Osmo)\s*)?Nano/i);
  if (djiNano) return '大疆 Osmo Nano';

  const insta = name.match(/(?:影石\s*)?Insta360\s*(GO\s*3S|Ace\s*Pro\s*2?)/i);
  if (insta) return `影石 Insta360 ${insta[1].replace(/\s+/g, ' ').replace(/Ace Pro2/i, 'Ace Pro 2').replace(/Ace Pro$/i, 'Ace Pro')}`;

  const fujiInstax = name.match(/富士\s*instax\s*(mini|SQUARE|wide)\s*(link\s*[23]|EVO|LiPlay|SQ(?:1|20|40)|(?:11|12|40|90|99|300|400))/i);
  if (fujiInstax) return `富士 instax ${fujiInstax[1]} ${fujiInstax[2].replace(/\s+/g, ' ')}`;

  const fujiXHalf = name.match(/富士\s*X[-\s]?half/i);
  if (fujiXHalf) return '富士 X-half';

  const sonyZv = name.match(/索尼\s*ZV-?1\b/i);
  if (sonyZv) return '索尼 ZV-1';

  const panasonic = name.match(/松下\s*(ZS99|ZS220D|FZ80D|ZS80D)\b/i);
  if (panasonic) return `松下 ${panasonic[1].toUpperCase()}`;

  const nikon = name.match(/尼康\s*(P1000|A900|B700)\b/i);
  if (nikon) return `尼康 ${nikon[1].toUpperCase()}`;

  const canonEos = name.match(/佳能\s*EOS\s*R50\b/i);
  if (canonEos) return '佳能 EOS R50';

  const canonIxus = name.match(/佳能\s*IXUS\s*(130|系列)?/i);
  if (canonIxus) return canonIxus[1] === '130' ? '佳能 IXUS 130' : '佳能 IXUS CCD';

  const canon = name.match(/佳能\s*((?:G7X|SX|CP)\s*\d+[A-Z]*|G\s*\d+)/i);
  if (canon) return `佳能 ${canon[1].replace(/\s+/g, '').toUpperCase().replace(/^(SX\d+)HS$/, '$1 HS')}`;

  const iphone = name.match(/\biPhone\s*(\d+)\s*(Pro|Plus|Air|mini)?\s*(Max)?/i);
  if (iphone) return ['iPhone', iphone[1], iphone[2] ? `${iphone[2][0].toUpperCase()}${iphone[2].slice(1).toLowerCase()}` : '', iphone[3] ? 'Max' : ''].filter(Boolean).join(' ');

  const ipad = name.match(/\biPad\s*(mini|Air|Pro)?\s*(\d*)\s*(\d{4}款)?/i);
  if (ipad) return ['iPad', ipad[1] ? `${ipad[1][0].toUpperCase()}${ipad[1].slice(1).toLowerCase()}` : '', ipad[2], ipad[3]].filter(Boolean).join(' ').replace('Mini ', 'mini');

  const vivo = name.match(/\bvivo\s+X\s*(\d+)\s+Ultra\b/i);
  if (vivo) return `vivo X${vivo[1]} Ultra`;

  return null;
}

function cleanProductName(productName: string): string {
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

  const cleaned = cleanProductName(row.productName);
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
