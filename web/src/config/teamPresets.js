export const REMOTE_CONFIG_URL = 'https://api.vmd1.dev/v1/config/qerobotics-stats';

export const DEFAULT_TEAMS = {
  VIQRC: [],
  V5RC: []
};

export const DEFAULT_HOME_URL = '#';
export const DEFAULT_API_PROXY_URL = 'https://api.vmd1.dev/v1/vex';

/**
 * Fetch remote config blob with fallback to localStorage and defaults
 */
export const fetchRemoteConfig = async () => {
  try {
    const res = await fetch(REMOTE_CONFIG_URL, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data) {
        if (data.home_url) {
          saveStoredHomeUrl(data.home_url);
        }
        if (data.teams) {
          saveStoredConfiguredTeams(data.teams);
        }
        if (data.api_proxy_url) {
          localStorage.setItem('vex_api_base_url', data.api_proxy_url);
        }
        return data;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch remote config from api.vmd1.dev, using cached/fallback:', err);
  }

  return {
    home_url: getStoredHomeUrl(),
    teams: getStoredConfiguredTeams(),
    api_proxy_url: localStorage.getItem('vex_api_base_url') || DEFAULT_API_PROXY_URL
  };
};

export const getStoredHomeUrl = () => {
  return localStorage.getItem('robotics_home_url') || DEFAULT_HOME_URL;
};

export const saveStoredHomeUrl = (url) => {
  if (url && url.trim()) {
    localStorage.setItem('robotics_home_url', url.trim());
  } else {
    localStorage.setItem('robotics_home_url', DEFAULT_HOME_URL);
  }
};

export const getStoredConfiguredTeams = () => {
  try {
    const saved = localStorage.getItem('robotics_configured_teams');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to parse configured teams from local storage', e);
  }
  return DEFAULT_TEAMS;
};

export const saveStoredConfiguredTeams = (config) => {
  localStorage.setItem('robotics_configured_teams', JSON.stringify(config));
};
