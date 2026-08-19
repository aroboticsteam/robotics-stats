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

  const response = await fetch(fullUrl, {
    headers: {
      'Accept': 'application/json'
    }
  });

  if (response.status === 429 && retryCount < 3) {
    await wait(1200 * (retryCount + 1));
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
 * Helper to fetch all pages for high-volume endpoints (e.g. matches)
 */
async function fetchAllPages(path, params = {}, maxPages = 6) {
  let allData = [];
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= maxPages) {
    const pageParams = { ...params, page, per_page: 100 };
    const res = await fetchWithCache(path, pageParams);
    const data = res.data || [];
    allData = allData.concat(data);

    if (res.meta && res.meta.last_page) {
      hasNext = page < res.meta.last_page;
    } else {
      hasNext = data.length === 100;
    }
    page++;
  }

  return allData;
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
 * Fetch team matches (with pagination so >100 historical matches are retrieved)
 */
export async function getTeamMatches(teamId, seasonId = null) {
  const params = {};
  if (seasonId) {
    params.season = [seasonId];
  }
  return await fetchAllPages(`/teams/${teamId}/matches`, params, 6);
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
