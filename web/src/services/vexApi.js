export const DEFAULT_PROXY_BASE = 'https://api.vmd1.dev/v1/vex';

export const getApiBaseUrl = () => {
  const saved = localStorage.getItem('vex_api_base_url');
  if (saved && saved.trim() && saved.trim() !== '/api/v2') return saved.trim();
  return DEFAULT_PROXY_BASE;
};

export const setApiBaseUrl = (url) => {
  if (url && url.trim()) {
    localStorage.setItem('vex_api_base_url', url.trim());
  } else {
    localStorage.removeItem('vex_api_base_url');
  }
};

// 30 minute cache in localStorage
const CACHE_PREFIX = 'vex_cache_v8_';
const CACHE_TTL_MS = 30 * 60 * 1000;

function getLocalStorageCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
      return parsed.data;
    }
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch (e) {
    console.error('Cache read error', e);
  }
  return null;
}

function setLocalStorageCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (e) {
    console.warn('Cache write error (possibly quota full)', e);
  }
}

export function clearLocalStorageCache() {
  try {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('vex_cache_')) {
        localStorage.removeItem(k);
      }
    });
  } catch (e) {
    console.error('Cache clear error', e);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cap simultaneous in-flight requests to the proxy so a cold cache (e.g. many
// teams loading at once) trickles requests out instead of bursting them, which
// is what tends to trip the upstream VEX API's rate limit.
const MAX_CONCURRENT_REQUESTS = 4;
let activeRequests = 0;
const requestQueue = [];

function runWithConcurrencyLimit(task) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeRequests++;
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      } finally {
        activeRequests--;
        const next = requestQueue.shift();
        if (next) next();
      }
    };

    if (activeRequests < MAX_CONCURRENT_REQUESTS) {
      run();
    } else {
      requestQueue.push(run);
    }
  });
}

/**
 * Fetch from proxy gateway with localStorage caching, automatic retry on 429, and pagination
 */
async function fetchWithCache(path, params = {}, retryCount = 0) {
  const baseUrl = getApiBaseUrl();
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      if (Array.isArray(v)) {
        v.forEach(val => searchParams.append(`${k}[]`, val));
      } else {
        searchParams.append(k, v);
      }
    }
  });

  const queryString = searchParams.toString();
  const fullUrl = `${baseUrl}${path}${queryString ? '?' + queryString : ''}`;
  const cacheKey = `${path}?${queryString}`;

  const cached = getLocalStorageCache(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await runWithConcurrencyLimit(() =>
    fetch(fullUrl, { headers: { 'Accept': 'application/json' } })
  );

  if (response.status === 429 && retryCount < 3) {
    const retryAfterHeader = Number(response.headers.get('Retry-After'));
    const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : 1200 * (retryCount + 1);
    // Jitter avoids many clients retrying in lockstep and re-triggering the limit together.
    const jitter = Math.random() * 500;
    await wait(retryAfterMs + jitter);
    return fetchWithCache(path, params, retryCount + 1);
  }

  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  setLocalStorageCache(cacheKey, data);
  return data;
}

/**
 * Get available seasons
 */
export async function getSeasons() {
  const json = await fetchWithCache('/seasons', { per_page: 100 });
  return json.data || [];
}

/**
 * Batch lookup teams by numbers
 */
export async function getTeamsByNumbers(teamNumbers) {
  if (!teamNumbers || teamNumbers.length === 0) return [];
  const json = await fetchWithCache('/teams', {
    number: teamNumbers,
    per_page: 100
  });
  return json.data || [];
}

/**
 * Fetch team skills scores
 */
export async function getTeamSkills(teamId, seasonId = null) {
  const params = { per_page: 100 };
  if (seasonId) {
    params.season = [seasonId];
  }
  const json = await fetchWithCache(`/teams/${teamId}/skills`, params);
  return json.data || [];
}

/**
 * Fetch team rankings
 */
export async function getTeamRankings(teamId, seasonId = null) {
  const params = { per_page: 100 };
  if (seasonId) {
    params.season = [seasonId];
  }
  const json = await fetchWithCache(`/teams/${teamId}/rankings`, params);
  return json.data || [];
}

/**
 * Fetch team awards
 */
export async function getTeamAwards(teamId, seasonId = null) {
  const params = { per_page: 100 };
  if (seasonId) {
    params.season = [seasonId];
  }
  const json = await fetchWithCache(`/teams/${teamId}/awards`, params);
  return json.data || [];
}

/**
 * Fetch a team's full match history. The proxy fetches and merges every
 * upstream page server-side, so this is always a single request.
 */
export async function getTeamMatches(teamId, seasonId = null) {
  const params = {};
  if (seasonId) {
    params.season = [seasonId];
  }
  const json = await fetchWithCache(`/teams/${teamId}/matches`, params);
  return json.data || [];
}

/**
 * Fetch team events
 */
export async function getTeamEvents(teamId, seasonId = null) {
  const params = { per_page: 100 };
  if (seasonId) {
    params.season = [seasonId];
  }
  const json = await fetchWithCache(`/teams/${teamId}/events`, params);
  return json.data || [];
}

/**
 * Comprehensive parallel team loader
 */
export async function getTeamComprehensiveData(teamId, seasonId = null) {
  const [skills, rankings, awards, matches, events] = await Promise.all([
    getTeamSkills(teamId, seasonId).catch(() => []),
    getTeamRankings(teamId, seasonId).catch(() => []),
    getTeamAwards(teamId, seasonId).catch(() => []),
    getTeamMatches(teamId, seasonId).catch(() => []),
    getTeamEvents(teamId, seasonId).catch(() => [])
  ]);

  return {
    skills,
    rankings,
    awards,
    matches,
    events
  };
}
