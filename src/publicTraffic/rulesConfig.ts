import { readFile } from 'node:fs/promises';

export interface PublicTrafficRulesConfig {
  topN: number;
  exposureOptimization: {
    highExposure: number;
    lowVisitRate: number;
    lowExposure: number;
    potentialVisits: number;
    potentialAmount: number;
  };
  conversionOptimization: {
    minVisits: number;
    weakAmount: number;
    minExposure: number;
  };
  newProductObservation: {
    lowExposure: number;
    zeroVisitMaxExposure: number;
  };
  lifecycleGovernance: {
    minCustodyDays: number;
    weak30dExposure: number;
    weak30dVisits: number;
    weak30dAmount: number;
  };
  health: {
    exposureDailyAverage: {
      failBelow: number;
      normalBelow: number;
    };
    visitRate: {
      badBelow: number;
      normalBelow: number;
    };
    amountKill: {
      windowDays: number;
      threshold: number;
    };
  };
}

export const DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG: PublicTrafficRulesConfig = {
  topN: 5,
  exposureOptimization: {
    highExposure: 1000,
    lowVisitRate: 0.01,
    lowExposure: 50,
    potentialVisits: 3,
    potentialAmount: 1,
  },
  conversionOptimization: {
    minVisits: 5,
    weakAmount: 1,
    minExposure: 100,
  },
  newProductObservation: {
    lowExposure: 20,
    zeroVisitMaxExposure: 100,
  },
  lifecycleGovernance: {
    minCustodyDays: 30,
    weak30dExposure: 100,
    weak30dVisits: 3,
    weak30dAmount: 1,
  },
  health: {
    exposureDailyAverage: {
      failBelow: 300,
      normalBelow: 1000,
    },
    visitRate: {
      badBelow: 0.02,
      normalBelow: 0.05,
    },
    amountKill: {
      windowDays: 14,
      threshold: 0,
    },
  },
};

const DEFAULT_RULES_CONFIG_PATH = 'config/public-traffic-rules.json';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function mergeSection<T extends Record<string, number>>(sectionName: string, defaults: T, override: unknown): T {
  if (override === undefined) return defaults;
  if (!isObject(override)) {
    throw new Error(`Invalid public traffic rules config: ${sectionName} must be an object`);
  }

  const section = { ...defaults };
  for (const key of Object.keys(override)) {
    if (!hasOwn(defaults, key)) {
      throw new Error(`Unknown public traffic rules config key: ${sectionName}.${key}`);
    }
  }

  for (const key of Object.keys(defaults)) {
    if (!hasOwn(override, key)) continue;
    const value = override[key];
    if (typeof value !== 'number') {
      throw new Error(`Invalid public traffic rules config: ${sectionName}.${key} must be a number`);
    }
    section[key as keyof T] = value as T[keyof T];
  }

  return section;
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid public traffic rules config: ${name} must be a finite non-negative number`);
  }
}

function validateNumberSection(sectionName: string, section: Record<string, number>): void {
  for (const [key, value] of Object.entries(section)) {
    assertFiniteNonNegative(`${sectionName}.${key}`, value);
  }
}

function validateConfig(config: PublicTrafficRulesConfig): void {
  if (!Number.isInteger(config.topN) || config.topN <= 0) {
    throw new Error('Invalid public traffic rules config: topN must be a positive integer');
  }

  validateNumberSection('exposureOptimization', config.exposureOptimization);
  validateNumberSection('conversionOptimization', config.conversionOptimization);
  validateNumberSection('newProductObservation', config.newProductObservation);
  validateNumberSection('lifecycleGovernance', config.lifecycleGovernance);
  validateNumberSection('health.exposureDailyAverage', config.health.exposureDailyAverage);
  validateNumberSection('health.visitRate', config.health.visitRate);
  validateNumberSection('health.amountKill', config.health.amountKill);

  if (config.exposureOptimization.lowVisitRate > 1) {
    throw new Error('Invalid public traffic rules config: exposureOptimization.lowVisitRate must be between 0 and 1');
  }
  if (config.health.exposureDailyAverage.failBelow >= config.health.exposureDailyAverage.normalBelow) {
    throw new Error('Invalid public traffic rules config: health.exposureDailyAverage.failBelow must be less than normalBelow');
  }
  if (config.health.visitRate.badBelow >= config.health.visitRate.normalBelow || config.health.visitRate.normalBelow > 1) {
    throw new Error('Invalid public traffic rules config: health.visitRate thresholds must be ordered between 0 and 1');
  }
  if (!Number.isInteger(config.health.amountKill.windowDays) || config.health.amountKill.windowDays <= 0) {
    throw new Error('Invalid public traffic rules config: health.amountKill.windowDays must be a positive integer');
  }
}

export async function loadPublicTrafficRulesConfig(path = DEFAULT_RULES_CONFIG_PATH): Promise<PublicTrafficRulesConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG;
    }
    throw error;
  }

  if (!isObject(parsed)) {
    throw new Error('Invalid public traffic rules config: root must be an object');
  }

  const knownTopLevelKeys = ['topN', 'exposureOptimization', 'conversionOptimization', 'newProductObservation', 'lifecycleGovernance', 'health'];
  for (const key of Object.keys(parsed)) {
    if (!knownTopLevelKeys.includes(key)) {
      throw new Error(`Unknown public traffic rules config key: ${key}`);
    }
  }

  if (hasOwn(parsed, 'topN') && typeof parsed.topN !== 'number') {
    throw new Error('Invalid public traffic rules config: topN must be a number');
  }

  const healthOverride = isObject(parsed.health) ? parsed.health : undefined;
  if (parsed.health !== undefined && !healthOverride) {
    throw new Error('Invalid public traffic rules config: health must be an object');
  }
  if (healthOverride) {
    const knownHealthKeys = ['exposureDailyAverage', 'visitRate', 'amountKill'];
    for (const key of Object.keys(healthOverride)) {
      if (!knownHealthKeys.includes(key)) {
        throw new Error(`Unknown public traffic rules config key: health.${key}`);
      }
    }
  }

  const config: PublicTrafficRulesConfig = {
    topN: typeof parsed.topN === 'number' ? parsed.topN : DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.topN,
    exposureOptimization: mergeSection('exposureOptimization', DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.exposureOptimization, parsed.exposureOptimization),
    conversionOptimization: mergeSection('conversionOptimization', DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.conversionOptimization, parsed.conversionOptimization),
    newProductObservation: mergeSection('newProductObservation', DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.newProductObservation, parsed.newProductObservation),
    lifecycleGovernance: mergeSection('lifecycleGovernance', DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.lifecycleGovernance, parsed.lifecycleGovernance),
    health: {
      exposureDailyAverage: mergeSection('health.exposureDailyAverage', DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.health.exposureDailyAverage, healthOverride?.exposureDailyAverage),
      visitRate: mergeSection('health.visitRate', DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.health.visitRate, healthOverride?.visitRate),
      amountKill: mergeSection('health.amountKill', DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.health.amountKill, healthOverride?.amountKill),
    },
  };

  validateConfig(config);
  return config;
}
