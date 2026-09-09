import React, { useState, useEffect, useMemo } from 'react';
import { 
  Trophy, 
  Bot, 
  Award, 
  ChevronRight, 
  RefreshCw, 
  Settings, 
  Sparkles, 
  SlidersHorizontal,
  Search,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
  Target,
  Flame,
  Medal,
  Activity,
  Layers,
  ChevronDown,
  Info,
  Key,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  Zap,
  Globe,
  Database,
  Home
} from 'lucide-react';
import { 
  getSeasons, 
  getTeamsByNumbers, 
  getTeamComprehensiveData, 
  getApiBaseUrl, 
  setApiBaseUrl,
  clearLocalStorageCache,
  DEFAULT_PROXY_BASE
} from './services/vexApi';
import { 
  DEFAULT_TEAMS, 
  DEFAULT_HOME_URL,
  getStoredConfiguredTeams, 
  saveStoredConfiguredTeams,
  getStoredHomeUrl,
  saveStoredHomeUrl,
  fetchRemoteConfig
} from './config/teamPresets';

const AUTO_REFRESH_INTERVAL_SECONDS = 180; // 3 minutes

// Helper to determine program & season mode from URL pathname
const parseRouteFromPath = () => {
  const path = window.location.pathname.toLowerCase();
  const isV5 = path.includes('v5rc') || path.includes('v5');
  const program = isV5 ? 'V5RC' : 'VIQRC';
  
  let seasonMode = 'all'; // 'all' | 'curr'
  if (path.includes('/curr')) {
    seasonMode = 'curr';
  } else if (path.includes('/all')) {
    seasonMode = 'all';
  }

  return { program, seasonMode };
};

export default function App() {
  const initialRoute = useMemo(() => parseRouteFromPath(), []);

  // Navigation & Config State
  const [selectedProgram, setSelectedProgram] = useState(initialRoute.program); // 'VIQRC' | 'V5RC'
  const [seasonMode, setSeasonMode] = useState(initialRoute.seasonMode); // 'all' | 'curr'
  const [teamConfig, setTeamConfig] = useState(getStoredConfiguredTeams());
  const [homeUrl, setHomeUrl] = useState(getStoredHomeUrl());
  const [activeTab, setActiveTab] = useState('skills'); // 'skills' | 'performance' | 'awards'
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(null); // explicitly null until initialized
  const [searchFilter, setSearchFilter] = useState('');
  
  // Modals & Settings State
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [apiProxyUrlInput, setApiProxyUrlInput] = useState(getApiBaseUrl());
  const [homeUrlInput, setHomeUrlInput] = useState(getStoredHomeUrl());
  const [editTeamsVIQRC, setEditTeamsVIQRC] = useState('');
  const [editTeamsV5RC, setEditTeamsV5RC] = useState('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [selectedTeamModal, setSelectedTeamModal] = useState(null);

  // Data Loading & Auto-refresh State
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(null);
  const [teamsData, setTeamsData] = useState({});

  // Filter available seasons for selected program
  const filteredSeasons = useMemo(() => {
    return seasons.filter(s => {
      const code = s.program?.code || '';
      const name = s.name || '';
      if (selectedProgram === 'VIQRC') {
        return code === 'VIQRC' || code === 'VIQC' || name.includes('IQ') || name.startsWith('VIQC');
      } else {
        return code === 'V5RC' || code === 'VRC' || code === 'VEXU' || name.includes('V5') || name.startsWith('VRC');
      }
    });
  }, [seasons, selectedProgram]);

  // Determine current active season object (first in list)
  const currentSeason = useMemo(() => {
    return filteredSeasons.length > 0 ? filteredSeasons[0] : null;
  }, [filteredSeasons]);

  // Listen to browser popstate / back / forward events
  useEffect(() => {
    const handleLocationChange = () => {
      const { program, seasonMode: mode } = parseRouteFromPath();
      setSelectedProgram(program);
      setSeasonMode(mode);
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  // Update browser URL on navigation
  const navigateToRoute = (program, mode) => {
    setSelectedProgram(program);
    setSeasonMode(mode);
    const progPath = program === 'V5RC' ? '/v5rc' : '/viqrc';
    const subPath = mode === 'curr' ? '/curr' : '/all';
    const targetPath = `${progPath}${subPath}`;
    
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ program, mode }, '', targetPath);
    }
  };

  // Re-sync selectedSeasonId whenever seasonMode, filteredSeasons, or program changes
  useEffect(() => {
    if (seasonMode === 'curr') {
      if (currentSeason) {
        setSelectedSeasonId(currentSeason.id.toString());
      }
    } else if (seasonMode === 'all') {
      setSelectedSeasonId('all');
    }
  }, [seasonMode, currentSeason, selectedProgram]);

  // Load Remote Config & Seasons on Mount
  useEffect(() => {
    async function initAppConfigAndSeasons() {
      try {
        const [remoteConf, seasonList] = await Promise.all([
          fetchRemoteConfig(),
          getSeasons()
        ]);

        if (remoteConf) {
          if (remoteConf.teams) setTeamConfig(remoteConf.teams);
          if (remoteConf.home_url) setHomeUrl(remoteConf.home_url);
        }

        setSeasons(seasonList || []);
      } catch (err) {
        console.error('Error initializing config or seasons:', err);
      }
    }
    initAppConfigAndSeasons();
  }, []);

  // Load Team Performance Data
  const loadPerformanceData = async (forceRefresh = false) => {
    if (selectedSeasonId === null) return; // Wait until season is determined

    if (forceRefresh) {
      clearLocalStorageCache();
    }
    setLoading(true);
    setApiError(null);

    try {
      const activeTeamNumbers = teamConfig[selectedProgram] || [];
      if (activeTeamNumbers.length === 0) {
        setTeamsData({});
        setLoading(false);
        return;
      }

      // 1. Single Batch Request for all team IDs
      const rawTeams = await getTeamsByNumbers(activeTeamNumbers);
      const teamMap = {};
      rawTeams.forEach(t => {
        if (selectedProgram === 'VIQRC' && (t.program?.code === 'VIQRC' || t.program?.code === 'VIQC')) {
          teamMap[t.number.toUpperCase()] = t;
        } else if (selectedProgram === 'V5RC' && (t.program?.code === 'V5RC' || t.program?.code === 'VRC')) {
          teamMap[t.number.toUpperCase()] = t;
        } else if (!teamMap[t.number.toUpperCase()]) {
          teamMap[t.number.toUpperCase()] = t;
        }
      });

      // 2. Parallel fetch for each team according to selected season
      const seasonFilter = selectedSeasonId === 'all' ? null : parseInt(selectedSeasonId, 10);
      const results = {};

      await Promise.all(
        activeTeamNumbers.map(async (num) => {
          const formattedNum = num.toUpperCase();
          const teamObj = teamMap[formattedNum];

          if (!teamObj || !teamObj.id) {
            results[formattedNum] = {
              team: { number: formattedNum, team_name: 'Team ' + formattedNum, grade: 'N/A' },
              skills: [],
              rankings: [],
              awards: [],
              matches: [],
              events: []
            };
            return;
          }

          const comprehensive = await getTeamComprehensiveData(teamObj.id, seasonFilter);

          results[formattedNum] = {
            team: teamObj,
            ...comprehensive
          };
        })
      );

      setTeamsData(results);
    } catch (err) {
      console.error('API fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Trigger data load when program, teamConfig, or selectedSeasonId changes
  useEffect(() => {
    if (selectedSeasonId !== null) {
      loadPerformanceData(false);
    }
  }, [selectedProgram, teamConfig, selectedSeasonId]);

  // Silent 180s Auto-refresh in the background
  useEffect(() => {
    const timer = setInterval(() => {
      loadPerformanceData(true);
    }, AUTO_REFRESH_INTERVAL_SECONDS * 1000);

    return () => clearInterval(timer);
  }, [selectedProgram, teamConfig, selectedSeasonId]);

  // Open config modal with current settings
  const handleOpenConfig = () => {
    setApiProxyUrlInput(getApiBaseUrl());
    setHomeUrlInput(homeUrl);
    setEditTeamsVIQRC((teamConfig.VIQRC || []).join(', '));
    setEditTeamsV5RC((teamConfig.V5RC || []).join(', '));
    setSaveSuccessMsg(false);
    setConfigModalOpen(true);
  };

  // Save config modal
  const handleSaveConfig = () => {
    setApiBaseUrl(apiProxyUrlInput);
    saveStoredHomeUrl(homeUrlInput);
    setHomeUrl(homeUrlInput || '#');
    const newConfig = {
      VIQRC: editTeamsVIQRC.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      V5RC: editTeamsV5RC.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    };
    setTeamConfig(newConfig);
    saveStoredConfiguredTeams(newConfig);
    setSaveSuccessMsg(true);
    setTimeout(() => {
      setConfigModalOpen(false);
      setSaveSuccessMsg(false);
    }, 900);
  };

  // Compute Processed Skills Leaderboard
  const processedSkillsLeaderboard = useMemo(() => {
    const activeTeamNumbers = teamConfig[selectedProgram] || [];
    
    return activeTeamNumbers.map(num => {
      const data = teamsData[num.toUpperCase()] || { team: { number: num }, skills: [] };
      const skills = data.skills || [];

      let maxDriver = 0;
      let maxAuton = 0;
      let bestDriverRecord = null;
      let bestAutonRecord = null;
      let bestEventName = '-';

      let totalDriverAttempts = 0;
      let totalAutonAttempts = 0;

      skills.forEach(s => {
        if (s.type === 'driver') {
          totalDriverAttempts += (s.attempts || 0);
          if (s.score >= maxDriver) {
            maxDriver = s.score;
            bestDriverRecord = s;
          }
        } else if (s.type === 'programming') {
          totalAutonAttempts += (s.attempts || 0);
          if (s.score >= maxAuton) {
            maxAuton = s.score;
            bestAutonRecord = s;
          }
        }
      });

      const totalScore = maxDriver + maxAuton;
      if (bestDriverRecord?.event?.name) {
        bestEventName = bestDriverRecord.event.name;
      } else if (bestAutonRecord?.event?.name) {
        bestEventName = bestAutonRecord.event.name;
      }

      return {
        number: num.toUpperCase(),
        name: data.team?.team_name || 'Team ' + num,
        total: totalScore,
        driver: maxDriver,
        auton: maxAuton,
        bestDriverAttempts: bestDriverRecord?.attempts ?? '-',
        bestAutonAttempts: bestAutonRecord?.attempts ?? '-',
        totalDriverAttempts,
        totalAutonAttempts,
        totalAttemptsSum: totalDriverAttempts + totalAutonAttempts,
        bestEvent: bestEventName,
        totalSkillsEntries: skills.length,
        rawSkills: skills
      };
    })
    .filter(item => {
      if (!searchFilter) return true;
      return item.number.toLowerCase().includes(searchFilter.toLowerCase()) || 
             item.name.toLowerCase().includes(searchFilter.toLowerCase());
    })
    .sort((a, b) => b.total - a.total);
  }, [teamConfig, selectedProgram, teamsData, searchFilter]);

  // Compute Processed Tournament / Overall Performance Leaderboard
  const processedTournamentLeaderboard = useMemo(() => {
    const activeTeamNumbers = teamConfig[selectedProgram] || [];

    return activeTeamNumbers.map(num => {
      const data = teamsData[num.toUpperCase()] || { team: { number: num }, rankings: [], awards: [], matches: [], skills: [] };
      const rankings = data.rankings || [];
      const awards = data.awards || [];
      const matches = data.matches || [];
      const skills = data.skills || [];

      let hiScore = 0;
      matches.forEach(m => {
        m.alliances?.forEach(alliance => {
          const hasThisTeam = alliance.teams?.some(t => t.team?.name?.toUpperCase() === num.toUpperCase() || t.team?.id === data.team?.id);
          if (hasThisTeam && alliance.score > hiScore) {
            hiScore = alliance.score;
          }
        });
      });

      rankings.forEach(r => {
        if (r.high_score > hiScore) hiScore = r.high_score;
      });

      const championAwards = awards.filter(a => {
        const title = (a.title || '').toLowerCase();
        return title.includes('champion') || title.includes('excellence') || a.classification === 'champion';
      });

      let qualAvgRank = '-';
      if (rankings.length > 0) {
        const sumRanks = rankings.reduce((acc, r) => acc + (r.rank || 0), 0);
        qualAvgRank = (sumRanks / rankings.length).toFixed(1);
      }

      let maxD = 0;
      let maxA = 0;
      skills.forEach(s => {
        if (s.type === 'driver' && s.score > maxD) maxD = s.score;
        if (s.type === 'programming' && s.score > maxA) maxA = s.score;
      });
      const maxSkills = maxD + maxA;

      return {
        number: num.toUpperCase(),
        name: data.team?.team_name || 'Team ' + num,
        eventWins: championAwards.length,
        qualAvgRank: qualAvgRank,
        hiScore: hiScore,
        awardsCount: awards.length,
        hiSkills: maxSkills,
        totalMatches: matches.length,
        totalRankings: rankings.length
      };
    })
    .filter(item => {
      if (!searchFilter) return true;
      return item.number.toLowerCase().includes(searchFilter.toLowerCase()) || 
             item.name.toLowerCase().includes(searchFilter.toLowerCase());
    })
    .sort((a, b) => {
      if (b.eventWins !== a.eventWins) return b.eventWins - a.eventWins;
      return b.hiSkills - a.hiSkills;
    });
  }, [teamConfig, selectedProgram, teamsData, searchFilter]);

  // Compute Processed Awards Breakdown
  const processedAwardsBreakdown = useMemo(() => {
    const activeTeamNumbers = teamConfig[selectedProgram] || [];

    return activeTeamNumbers.map(num => {
      const data = teamsData[num.toUpperCase()] || { team: { number: num }, awards: [] };
      const awards = data.awards || [];

      let excellence = 0;
      let teamworkChampion = 0;
      let skillsChampion = 0;
      let design = 0;
      let innovate = 0;
      let judges = 0;
      let other = 0;

      awards.forEach(a => {
        const title = (a.title || '').toLowerCase();
        if (title.includes('excellence')) excellence++;
        else if (title.includes('teamwork champion') || title.includes('tournament champion')) teamworkChampion++;
        else if (title.includes('robot skills champion') || title.includes('skills champion')) skillsChampion++;
        else if (title.includes('design')) design++;
        else if (title.includes('innovate')) innovate++;
        else if (title.includes('judges')) judges++;
        else other++;
      });

      const total = awards.length;

      return {
        number: num.toUpperCase(),
        name: data.team?.team_name || 'Team ' + num,
        total,
        excellence,
        tc: teamworkChampion,
        skills: skillsChampion,
        design,
        innovate,
        judges,
        other,
        allAwards: awards
      };
    })
    .filter(item => {
      if (!searchFilter) return true;
      return item.number.toLowerCase().includes(searchFilter.toLowerCase()) || 
             item.name.toLowerCase().includes(searchFilter.toLowerCase());
    })
    .sort((a, b) => b.total - a.total);
  }, [teamConfig, selectedProgram, teamsData, searchFilter]);

  // Aggregate Metrics for Header
  const summaryMetrics = useMemo(() => {
    let totalAwards = 0;
    let maxOverallSkills = 0;
    let topTeam = '-';
    let totalEvents = new Set();

    Object.values(teamsData).forEach(td => {
      totalAwards += (td.awards || []).length;
      let dMax = 0, aMax = 0;
      (td.skills || []).forEach(s => {
        if (s.type === 'driver' && s.score > dMax) dMax = s.score;
        if (s.type === 'programming' && s.score > aMax) aMax = s.score;
      });
      const tot = dMax + aMax;
      if (tot > maxOverallSkills) {
        maxOverallSkills = tot;
        topTeam = td.team?.number || '-';
      }
      (td.events || []).forEach(e => totalEvents.add(e.id));
    });

    return {
      totalAwards: totalAwards,
      maxOverallSkills: maxOverallSkills,
      topTeam: topTeam !== '-' ? topTeam : '-',
      eventsAttended: totalEvents.size
    };
  }, [teamsData]);

  return (
    <div className="min-h-screen bg-[#111c2e] text-slate-100 flex flex-col selection:bg-[#cbb58c] selection:text-[#111c2e]">
      
      {/* Top Header */}
      <header className="w-full bg-[#111c2e] border-b border-slate-800/80 pt-4 pb-4 px-4 sm:px-8 lg:px-12">
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 md:grid-cols-3 items-center gap-4">
          
          {/* Left: Kingston Logo & Home Link */}
          <div className="flex items-center justify-center md:justify-start gap-3">
            <div className="bg-white px-3.5 py-1.5 rounded-xl transition-all duration-300 shadow-md flex items-center justify-center hover:shadow-lg">
              <img 
                src="/logos/kingston.png" 
                alt="Kingston Technology" 
                className="h-8 sm:h-9 w-auto object-contain"
              />
            </div>
            
            {/* Customisable Home Link */}
            <a 
              href={homeUrl}
              className="text-xs font-medium text-slate-400 hover:text-[#cbb58c] transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/60 hover:border-[#cbb58c]/40 cursor-pointer"
              title={`Navigate to Home (${homeUrl})`}
            >
              <Home className="w-3.5 h-3.5" />
              <span>Home</span>
            </a>
          </div>

          {/* Center: QE School Logo (Strictly Centred) */}
          <div className="flex flex-col items-center justify-center text-center">
            <img 
              src="/logos/qe-school.png" 
              alt="Queen Elizabeth's School - Founded in 1573" 
              className="h-20 sm:h-24 md:h-28 w-auto object-contain drop-shadow-lg hover:scale-105 transition-transform duration-300 mx-auto"
            />
          </div>

          {/* Right: Actions & Config button */}
          <div className="flex items-center justify-center md:justify-end gap-2.5 flex-wrap">
            <button 
              onClick={() => loadPerformanceData(true)}
              disabled={loading}
              className="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm rounded-xl border border-slate-700/80 flex items-center gap-2 transition-all shadow hover:text-white cursor-pointer"
              title="Force Refresh Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#cbb58c] ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button 
              onClick={handleOpenConfig}
              className="px-3.5 py-2 bg-[#1b2b45] hover:bg-[#223657] text-[#e8d7b8] text-xs sm:text-sm font-medium rounded-xl border border-[#cbb58c]/40 hover:border-[#cbb58c]/80 flex items-center gap-2 transition-all shadow-md cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-[#cbb58c]" />
              <span>Configure</span>
            </button>
          </div>
        </div>

        {/* Hero Title & Live Status */}
        <div className="text-center pt-6 pb-1 max-w-[1600px] mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1b2b45]/80 border border-[#cbb58c]/30 text-xs font-semibold text-[#e8d7b8] uppercase tracking-wider mb-2">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            Live {selectedProgram} Competition Analytics ({selectedSeasonId === 'all' ? 'Historical All-Time' : 'Current Season'})
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-normal tracking-tight text-white/95">
            Queen Elizabeth's School Robotics Stats ({selectedProgram})
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1.5 max-w-2xl mx-auto">
            Official performance benchmarks, robot skills rankings, tournament awards, and match telemetry.
          </p>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-[1650px] mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
        
        {/* Top Controls Bar: Program Selector, Season Selector, Search */}
        <section className="bg-[#142137]/90 border border-slate-700/70 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur flex flex-col lg:flex-row items-center justify-between gap-4">
          
          {/* Program Toggle (VIQRC vs V5RC) */}
          <div className="flex items-center gap-2 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 w-full sm:w-auto">
            <button
              onClick={() => navigateToRoute('VIQRC', seasonMode)}
              className={`flex-1 sm:flex-initial px-5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                selectedProgram === 'VIQRC'
                  ? 'bg-gradient-to-r from-sky-600 to-blue-700 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>VIQRC (IQ Teams)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/30 ml-1">
                {teamConfig.VIQRC?.length || 0}
              </span>
            </button>

            <button
              onClick={() => navigateToRoute('V5RC', seasonMode)}
              className={`flex-1 sm:flex-initial px-5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                selectedProgram === 'V5RC'
                  ? 'bg-gradient-to-r from-rose-600 to-red-700 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>V5RC (V5 Teams)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/30 ml-1">
                {teamConfig.V5RC?.length || 0}
              </span>
            </button>
          </div>

          {/* Season Filter & Search */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
            
            {/* Season Filter Dropdown */}
            <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-300 w-full sm:w-auto">
              <Layers className="w-4 h-4 text-[#cbb58c]" />
              <span className="font-medium text-slate-400">Season:</span>
              <select
                value={selectedSeasonId || 'all'}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedSeasonId(val);
                  if (val === 'all') {
                    navigateToRoute(selectedProgram, 'all');
                  } else {
                    navigateToRoute(selectedProgram, 'curr');
                  }
                }}
                className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer max-w-[220px] truncate"
              >
                <option value="all" className="bg-slate-900 text-slate-200">All Seasons / Historical</option>
                {filteredSeasons.map((s, idx) => (
                  <option key={s.id} value={s.id.toString()} className="bg-slate-900 text-slate-200">
                    {s.name} {idx === 0 ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Filter Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search team number..."
                className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#cbb58c]/60"
              />
            </div>
          </div>
        </section>

        {/* Quick KPI Stat Cards */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-[#142137]/80 border border-slate-800/80 rounded-xl p-4 flex items-center gap-3.5 shadow-lg">
            <div className="w-11 h-11 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Trophy className="w-5 h-5 text-[#cbb58c]" />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {loading ? '...' : summaryMetrics.totalAwards}
              </div>
              <div className="text-[11px] sm:text-xs text-slate-400 font-medium uppercase tracking-wider">
                Total Team Awards
              </div>
            </div>
          </div>

          <div className="bg-[#142137]/80 border border-slate-800/80 rounded-xl p-4 flex items-center gap-3.5 shadow-lg">
            <div className="w-11 h-11 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {loading ? '...' : summaryMetrics.maxOverallSkills}
              </div>
              <div className="text-[11px] sm:text-xs text-slate-400 font-medium uppercase tracking-wider">
                Highest Skills Score
              </div>
            </div>
          </div>

          <div className="bg-[#142137]/80 border border-slate-800/80 rounded-xl p-4 flex items-center gap-3.5 shadow-lg">
            <div className="w-11 h-11 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Medal className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {loading ? '...' : summaryMetrics.topTeam}
              </div>
              <div className="text-[11px] sm:text-xs text-slate-400 font-medium uppercase tracking-wider">
                Top Skills Team
              </div>
            </div>
          </div>

          <div className="bg-[#142137]/80 border border-slate-800/80 rounded-xl p-4 flex items-center gap-3.5 shadow-lg">
            <div className="w-11 h-11 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center flex-shrink-0">
              <Activity className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {teamConfig[selectedProgram]?.length || 0}
              </div>
              <div className="text-[11px] sm:text-xs text-slate-400 font-medium uppercase tracking-wider">
                Configured Teams ({selectedProgram})
              </div>
            </div>
          </div>
        </section>

        {/* Tab Navigation for Tables */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('skills')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'skills'
                ? 'bg-[#cbb58c] text-[#111c2e] shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Robot Skills Leaderboard</span>
          </button>

          <button
            onClick={() => setActiveTab('performance')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'performance'
                ? 'bg-[#cbb58c] text-[#111c2e] shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>Tournament & Match Stats</span>
          </button>

          <button
            onClick={() => setActiveTab('awards')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'awards'
                ? 'bg-[#cbb58c] text-[#111c2e] shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>Awards Breakdown</span>
          </button>
        </div>

        {/* Content Section: Table 1 - Skills Rankings */}
        {activeTab === 'skills' && (
          <div className="bg-[#142137]/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 sm:p-6 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                  <span>Robot Skills Rankings & High Scores</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {selectedProgram}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    {selectedSeasonId === 'all' ? 'Historical All-Time PB' : 'Season High Scores'}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Peak driver & autonomous programming scores recorded at official VEX events with attempts at best event.
                </p>
              </div>
              <div className="text-xs text-slate-400">
                Sorted by <span className="text-[#cbb58c] font-semibold">Peak Skills Total</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-900/90 text-slate-300 font-semibold border-b border-slate-800 text-[11px] sm:text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-4 text-center w-16">QE Rank</th>
                    <th className="py-3.5 px-4">Team</th>
                    <th className="py-3.5 px-4 text-right">Total PB</th>
                    <th className="py-3.5 px-4 text-right">Driver Score</th>
                    <th className="py-3.5 px-4 text-center">Att (Best Run)</th>
                    <th className="py-3.5 px-4 text-right">Auton Score</th>
                    <th className="py-3.5 px-4 text-center">Att (Best Run)</th>
                    <th className="py-3.5 px-4 text-center">Lifetime Runs</th>
                    <th className="py-3.5 px-4">Best Event Recorded</th>
                    <th className="py-3.5 px-4 text-center">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#cbb58c] mb-2" />
                        Loading live skills telemetry via secure proxy...
                      </td>
                    </tr>
                  ) : processedSkillsLeaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
                        No team performance records found for current criteria.
                      </td>
                    </tr>
                  ) : (
                    processedSkillsLeaderboard.map((row, idx) => (
                      <tr 
                        key={row.number}
                        className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                        onClick={() => setSelectedTeamModal(teamsData[row.number])}
                      >
                        <td className="py-3.5 px-4 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                            idx === 0 
                              ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20 ring-2 ring-amber-400/40' 
                              : idx === 1 
                              ? 'bg-slate-300 text-slate-950 font-bold' 
                              : idx === 2 
                              ? 'bg-amber-700 text-amber-100 font-bold'
                              : 'bg-slate-800 text-slate-300'
                          }`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white text-sm sm:text-base group-hover:text-[#cbb58c] transition-colors flex items-center gap-2">
                            <span>{row.number}</span>
                            {idx === 0 && <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                          </div>
                          <div className="text-xs text-slate-400 font-normal truncate max-w-[180px]">
                            {row.name}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-sm sm:text-base text-[#e8d7b8]">
                          {row.total}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-cyan-300 font-bold">
                          {row.driver}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-400 text-xs">
                          {row.bestDriverAttempts !== '-' ? `${row.bestDriverAttempts} / 3` : '-'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-indigo-300 font-bold">
                          {row.auton}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-400 text-xs">
                          {row.bestAutonAttempts !== '-' ? `${row.bestAutonAttempts} / 3` : '-'}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono font-medium text-[#cbb58c]">
                          <span className="inline-block px-2 py-0.5 rounded bg-slate-900 border border-slate-800" title={`Total attempts: ${row.totalDriverAttempts} driver, ${row.totalAutonAttempts} autonomous across ${row.totalSkillsEntries / 2} events`}>
                            {row.totalAttemptsSum} runs
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 truncate max-w-[220px]">
                          {row.bestEvent}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <button 
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-[#cbb58c] hover:text-[#111c2e] text-slate-400 transition-all cursor-pointer"
                            title="View Full Team Profile"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Content Section: Table 2 - Tournament & Match Stats */}
        {activeTab === 'performance' && (
          <div className="bg-[#142137]/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 sm:p-6 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                  <span>Tournament, Match & Ranking Stats</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                    {selectedProgram}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Event Championships, Qualification Average Ranks, Single Match High Scores, and Total Awards Won.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-900/90 text-slate-300 font-semibold border-b border-slate-800 text-[11px] sm:text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-4 text-center w-16">Rank</th>
                    <th className="py-3.5 px-4">Team</th>
                    <th className="py-3.5 px-4 text-center">Event Wins (Champs)</th>
                    <th className="py-3.5 px-4 text-center">Qual Avg Rank</th>
                    <th className="py-3.5 px-4 text-right">Match Hi Score</th>
                    <th className="py-3.5 px-4 text-center font-bold text-[#cbb58c]">Total Awards</th>
                    <th className="py-3.5 px-4 text-right">Hi Skills</th>
                    <th className="py-3.5 px-4 text-center">Total Matches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#cbb58c] mb-2" />
                        Loading tournament telemetry...
                      </td>
                    </tr>
                  ) : processedTournamentLeaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        No team performance records found.
                      </td>
                    </tr>
                  ) : (
                    processedTournamentLeaderboard.map((row, idx) => (
                      <tr 
                        key={row.number}
                        className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                        onClick={() => setSelectedTeamModal(teamsData[row.number])}
                      >
                        <td className="py-3.5 px-4 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                            idx === 0 
                              ? 'bg-amber-400 text-slate-950 font-bold' 
                              : idx === 1 
                              ? 'bg-slate-300 text-slate-950 font-bold' 
                              : idx === 2 
                              ? 'bg-amber-700 text-amber-100 font-bold'
                              : 'bg-slate-800 text-slate-300'
                          }`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white text-sm sm:text-base group-hover:text-[#cbb58c] transition-colors">
                            {row.number}
                          </div>
                          <div className="text-xs text-slate-400 font-normal truncate max-w-[180px]">
                            {row.name}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-emerald-400">
                          {row.eventWins > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-500/30">
                              <Trophy className="w-3.5 h-3.5 text-emerald-400" />
                              {row.eventWins}
                            </span>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                          {row.qualAvgRank !== '-' ? `#${row.qualAvgRank}` : '-'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-[#e8d7b8]">
                          {row.hiScore > 0 ? row.hiScore : '-'}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="inline-block px-2.5 py-0.5 rounded-md bg-[#cbb58c]/20 text-[#e8d7b8] font-bold border border-[#cbb58c]/40">
                            {row.awardsCount}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-cyan-300">
                          {row.hiSkills}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-400 font-bold">
                          {row.totalMatches}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Content Section: Table 3 - Awards Breakdown */}
        {activeTab === 'awards' && (
          <div className="bg-[#142137]/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 sm:p-6 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                  <span>Honours & Awards Distribution</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {selectedProgram}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Excellence, Teamwork Champion (TC), Skills Champion, Design, Innovate, and Judges awards.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-900/90 text-slate-300 font-semibold border-b border-slate-800 text-[11px] sm:text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-4 text-center w-16">Rank</th>
                    <th className="py-3.5 px-4">Team</th>
                    <th className="py-3.5 px-4 text-center font-bold text-[#cbb58c]">Total Awards</th>
                    <th className="py-3.5 px-4 text-center">Excellence (Exc)</th>
                    <th className="py-3.5 px-4 text-center">Teamwork Champ (TC)</th>
                    <th className="py-3.5 px-4 text-center">Skills Champ</th>
                    <th className="py-3.5 px-4 text-center">Design</th>
                    <th className="py-3.5 px-4 text-center">Innovate</th>
                    <th className="py-3.5 px-4 text-center">Judges</th>
                    <th className="py-3.5 px-4 text-center">Other</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#cbb58c] mb-2" />
                        Loading awards records...
                      </td>
                    </tr>
                  ) : processedAwardsBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
                        No awards found for the selected configuration.
                      </td>
                    </tr>
                  ) : (
                    processedAwardsBreakdown.map((row, idx) => (
                      <tr 
                        key={row.number}
                        className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                        onClick={() => setSelectedTeamModal(teamsData[row.number])}
                      >
                        <td className="py-3.5 px-4 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                            idx === 0 
                              ? 'bg-amber-400 text-slate-950 font-bold' 
                              : idx === 1 
                              ? 'bg-slate-300 text-slate-950 font-bold' 
                              : idx === 2 
                              ? 'bg-amber-700 text-amber-100 font-bold'
                              : 'bg-slate-800 text-slate-300'
                          }`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white text-sm sm:text-base group-hover:text-[#cbb58c] transition-colors">
                            {row.number}
                          </div>
                          <div className="text-xs text-slate-400 font-normal truncate max-w-[180px]">
                            {row.name}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-base text-[#e8d7b8]">
                          <span className="inline-block px-3 py-1 rounded-lg bg-[#cbb58c]/20 border border-[#cbb58c]/40">
                            {row.total}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-amber-300">
                          {row.excellence || '-'}
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-emerald-400">
                          {row.tc || '-'}
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-cyan-300">
                          {row.skills || '-'}
                        </td>
                        <td className="py-3.5 px-4 text-center text-slate-300">
                          {row.design || '-'}
                        </td>
                        <td className="py-3.5 px-4 text-center text-slate-300">
                          {row.innovate || '-'}
                        </td>
                        <td className="py-3.5 px-4 text-center text-slate-300">
                          {row.judges || '-'}
                        </td>
                        <td className="py-3.5 px-4 text-center text-slate-400">
                          {row.other || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-800/80 py-4 px-6 text-center text-xs sm:text-sm text-slate-400 flex flex-col sm:flex-row items-center justify-between max-w-[1600px] mx-auto gap-2">
        <p>© {new Date().getFullYear()} QE Robotics • Queen Elizabeth's School, Barnet</p>
        <p className="text-slate-500 text-xs">
          VEX Robotics Competition Performance Portal
        </p>
      </footer>

      {/* Team Details Modal */}
      {selectedTeamModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
          onClick={() => setSelectedTeamModal(null)}
        >
          <div 
            className="relative w-full max-w-3xl bg-[#142137] border border-slate-700 rounded-2xl p-6 sm:p-8 shadow-2xl text-slate-100 overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-700/80 pb-4">
              <div>
                <span className="inline-block px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider rounded-full bg-[#cbb58c]/20 text-[#e8d7b8] border border-[#cbb58c]/30 mb-2">
                  {selectedTeamModal.team?.program?.code || selectedProgram} Team Record
                </span>
                <h3 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
                  <span>Team {selectedTeamModal.team?.number}</span>
                  <span className="text-base font-medium text-[#cbb58c]">
                    {selectedTeamModal.team?.team_name}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {selectedTeamModal.team?.organization} • {selectedTeamModal.team?.location?.city || 'London, UK'} • Grade: {selectedTeamModal.team?.grade || 'Middle School'}
                </p>
              </div>
              <button 
                onClick={() => setSelectedTeamModal(null)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="py-6 space-y-6 overflow-y-auto flex-1 pr-1">
              
              {/* Award List */}
              <div>
                <h4 className="text-sm font-bold text-[#e8d7b8] uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Award className="w-4 h-4 text-[#cbb58c]" />
                  <span>Awards Received ({selectedTeamModal.awards?.length || 0})</span>
                </h4>
                {(!selectedTeamModal.awards || selectedTeamModal.awards.length === 0) ? (
                  <p className="text-xs text-slate-500 italic">No awards found for this team in the selected season.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {selectedTeamModal.awards.map((award, i) => (
                      <div key={i} className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex items-start gap-2.5">
                        <Trophy className="w-4 h-4 text-[#cbb58c] flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-white">{award.title}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{award.event?.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Skills Runs List */}
              <div>
                <h4 className="text-sm font-bold text-[#e8d7b8] uppercase tracking-wider mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#cbb58c]" />
                  <span>Recent Skills Runs ({selectedTeamModal.skills?.length || 0})</span>
                </h4>
                {(!selectedTeamModal.skills || selectedTeamModal.skills.length === 0) ? (
                  <p className="text-xs text-slate-500 italic">No skills runs recorded.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {selectedTeamModal.skills.slice(0, 15).map((skill, i) => (
                      <div key={i} className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
                        <div>
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase mr-2 ${
                            skill.type === 'driver' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                          }`}>
                            {skill.type}
                          </span>
                          <span className="text-slate-300 font-medium">{skill.event?.name}</span>
                        </div>
                        <div className="flex items-center gap-3 font-mono">
                          <span className="text-slate-400">Rank: #{skill.rank}</span>
                          <span className="text-white font-bold text-sm bg-slate-800 px-2 py-0.5 rounded">{skill.score} pts</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-700/80 pt-4 flex justify-end">
              <button 
                onClick={() => setSelectedTeamModal(null)}
                className="px-5 py-2 rounded-xl bg-[#cbb58c] hover:bg-[#d8c59f] text-[#111c2e] font-semibold text-sm transition-colors shadow-lg cursor-pointer"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Modal */}
      {configModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
          onClick={() => setConfigModalOpen(false)}
        >
          <div 
            className="relative w-full max-w-xl bg-[#142137] border border-slate-700 rounded-2xl p-6 sm:p-8 shadow-2xl text-slate-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-700/80 pb-4">
              <div>
                <span className="inline-block px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider rounded-full bg-[#cbb58c]/20 text-[#e8d7b8] border border-[#cbb58c]/30 mb-2">
                  Portal Settings
                </span>
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <SlidersHorizontal className="w-5 h-5 text-[#cbb58c]" />
                  <span>Configure Teams, Links & API Proxy</span>
                </h3>
              </div>
              <button 
                onClick={() => setConfigModalOpen(false)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <div className="py-6 space-y-4">
              
              {/* Home Button URL Config */}
              <div>
                <label className="block text-xs font-semibold text-[#e8d7b8] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Home className="w-3.5 h-3.5 text-[#cbb58c]" />
                  <span>Home Button Target URL</span>
                </label>
                <input 
                  type="text"
                  value={homeUrlInput}
                  onChange={(e) => setHomeUrlInput(e.target.value)}
                  placeholder="e.g. # or https://qerobotics.org"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-[#cbb58c]"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Destination URL for the top-left "Home" button (default is <code className="text-[#e8d7b8]">#</code>).
                </p>
              </div>

              {/* VIQRC Teams Config */}
              <div>
                <label className="block text-xs font-semibold text-[#e8d7b8] uppercase tracking-wider mb-1.5">
                  VIQRC Team Numbers (Comma Separated)
                </label>
                <input 
                  type="text"
                  value={editTeamsVIQRC}
                  onChange={(e) => setEditTeamsVIQRC(e.target.value)}
                  placeholder="e.g. 21549A, 21549B, 21549C..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-[#cbb58c]"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Active VEX IQ teams to display on the VIQRC leaderboard.
                </p>
              </div>

              {/* V5RC Teams Config */}
              <div>
                <label className="block text-xs font-semibold text-[#e8d7b8] uppercase tracking-wider mb-1.5">
                  V5RC Team Numbers (Comma Separated)
                </label>
                <input 
                  type="text"
                  value={editTeamsV5RC}
                  onChange={(e) => setEditTeamsV5RC(e.target.value)}
                  placeholder="e.g. 21549M, 21549S, 21549V..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-[#cbb58c]"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Active VEX V5 teams to display on the V5RC leaderboard.
                </p>
              </div>

              {/* API Proxy Base URL */}
              <div>
                <label className="block text-xs font-semibold text-[#e8d7b8] uppercase tracking-wider mb-1.5">
                  API Proxy Gateway Path / URL
                </label>
                <input 
                  type="text"
                  value={apiProxyUrlInput}
                  onChange={(e) => setApiProxyUrlInput(e.target.value)}
                  placeholder="https://api.vmd1.dev/v1/vex"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-slate-200 focus:outline-none focus:border-[#cbb58c]"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Default is <code className="text-[#e8d7b8]">https://api.vmd1.dev/v1/vex</code>.
                </p>
              </div>

              {saveSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Configuration saved successfully! Refreshing live stats...</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-slate-700/80 pt-4 flex items-center justify-between">
              <button 
                onClick={() => {
                  setHomeUrlInput(DEFAULT_HOME_URL);
                  setEditTeamsVIQRC(DEFAULT_TEAMS.VIQRC.join(', '));
                  setEditTeamsV5RC(DEFAULT_TEAMS.V5RC.join(', '));
                  setApiProxyUrlInput(DEFAULT_PROXY_BASE);
                }}
                className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
              >
                Reset to Defaults
              </button>

              <div className="flex gap-2">
                <button 
                  onClick={() => setConfigModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveConfig}
                  className="px-5 py-2 rounded-xl bg-[#cbb58c] hover:bg-[#d8c59f] text-[#111c2e] font-bold text-xs shadow-lg cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
