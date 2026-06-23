/**
 * Central dictionary for all metrics and label definitions.
 * Keys are mapped case-insensitively and support various abbreviations/aliases.
 */

const DEFINITIONS = {
  team_rating: {
    name: 'Team Rating (0–1000)',
    measures: 'A combined performance score that summarizes a team\'s overall strength across fighting power, placement ability, and conversion efficiency.',
    interpretation: 'Higher ratings indicate stronger overall performance.'
  },
  power: {
    name: 'Power',
    measures: 'Measures a team\'s raw fighting strength and scoring ability.',
    interpretation: 'Calculated from scoring output, kill production, and combat efficiency.'
  },
  ppm: {
    name: 'PPM (Points Per Match)',
    measures: 'Average points earned per match.',
    interpretation: 'A strong indicator of overall performance and scoring consistency.'
  },
  kpm: {
    name: 'KPM (Kills Per Match)',
    measures: 'Average kills earned per match.',
    interpretation: 'Reflects a team\'s ability to secure eliminations consistently.'
  },
  kill_efficiency: {
    name: 'Kill Efficiency',
    measures: 'Measures how effectively a team converts its gameplay into kill-based points.',
    interpretation: 'Higher values indicate stronger combat impact.'
  },
  placement_control: {
    name: 'Placement Control',
    measures: 'Measures a team\'s survival skills, positioning, and ability to secure strong placements consistently.',
    interpretation: 'Higher placement control indicates reliable positioning and survival.'
  },
  avg_placement: {
    name: 'Avg Placement',
    measures: 'Average finishing position across all matches.',
    interpretation: 'Lower values indicate better overall placement performance.'
  },
  top_3_finish_rate: {
    name: 'Top 3 Finish Rate',
    measures: 'The frequency at which a team finishes inside the Top 3.',
    interpretation: 'Highlights consistency at reaching end-game situations.'
  },
  placement_efficiency: {
    name: 'Placement Efficiency',
    measures: 'Measures how effectively a team converts match participation into placement success.',
    interpretation: 'Higher values indicate stronger survival performance.'
  },
  placement_dominance: {
    name: 'Placement Dominance',
    measures: 'Reflects a team\'s ability to consistently secure high placements compared to the rest of the field.',
    interpretation: 'Higher dominance reflects consistent end-game control.'
  },
  dpm: {
    name: 'DPM (Damage Per Match)',
    measures: 'Average damage dealt per match, reflects combat engagement alongside kills.',
    interpretation: 'Higher values indicate greater damage contribution.'
  },
  top_5_finish_rate: {
    name: 'Top 5 Finish Rate',
    measures: 'Frequency of finishing inside the Top 5, a wider lens than Top 3.',
    interpretation: 'Higher rate indicates consistent high placement.'
  },
  top_3_vs_5_spread: {
    name: 'Top 3 vs 5 Spread',
    measures: 'The gap between Top 3 and Top 5 finish rate; small spread means most strong finishes are already podium finishes, large spread means many finishes land just outside the podium.',
    interpretation: 'Reflects how close a team gets to podium finishes.'
  },
  conversion: {
    name: 'Conversion',
    measures: 'Measures a team\'s ability to turn strong opportunities into match victories.',
    interpretation: 'Higher conversion indicates clutch performance when closing out games.'
  },
  win_rate: {
    name: 'Win Rate',
    measures: 'Percentage of matches won.',
    interpretation: 'Shows how often a team finishes in first place.'
  },
  conversion_rate: {
    name: 'Conversion Rate',
    measures: 'Measures how often a team converts Top 3 appearances into actual wins.',
    interpretation: 'Highlights clutch performance under pressure.'
  },
  form: {
    name: 'Form',
    measures: 'Measures a team\'s recent trend and consistency throughout the event.',
    interpretation: 'Indicates team momentum and stability of performance.'
  },
  momentum_index: {
    name: 'Momentum Index',
    measures: 'Tracks whether a team\'s performance is improving or declining over time.',
    interpretation: 'Positive values indicate improvement, while negative values indicate a downward trend.'
  },
  consistency_score: {
    name: 'Consistency Score',
    measures: 'Measures how stable a team\'s performance is across the event.',
    interpretation: 'Higher scores indicate more reliable results from match to match.'
  },
  playstyle: {
    name: 'Playstyle',
    measures: 'An automatically generated profile based on a team\'s strengths across Power, Placement Control, Conversion, and Form.',
    interpretation: 'Used to classify a team\'s tactical style (e.g. Aggressive, Tactical, Balanced).'
  }
};

const LABELS = {
  // Playstyles
  'aggressive': {
    name: 'Aggressive',
    measures: 'Playstyle Profile',
    interpretation: 'Relies heavily on kills and fighting power to achieve results.'
  },
  'aggressive clutch': {
    name: 'Aggressive Clutch',
    measures: 'Playstyle Profile',
    interpretation: 'Combines strong fighting ability with excellent game-closing potential.'
  },
  'tactical': {
    name: 'Tactical',
    measures: 'Playstyle Profile',
    interpretation: 'Prioritizes positioning, rotations, and placement consistency.'
  },
  'tactical clutch': {
    name: 'Tactical Clutch',
    measures: 'Playstyle Profile',
    interpretation: 'Excels at both survival and converting opportunities into wins.'
  },
  'defensive': {
    name: 'Defensive',
    measures: 'Playstyle Profile',
    interpretation: 'Focuses on survival, risk management, and placement accumulation.'
  },
  'clutch': {
    name: 'Clutch',
    measures: 'Playstyle / Conversion Label',
    interpretation: 'Frequently delivers results in high-pressure situations, or excellent at turning opportunities into wins.'
  },
  'balanced': {
    name: 'Balanced',
    measures: 'Playstyle / Power Label',
    interpretation: 'Shows no overwhelming strength or weakness across categories, or competitive across most situations.'
  },

  // Power Labels
  'elite': {
    name: 'Elite',
    measures: 'Power Label',
    interpretation: 'Exceptional fighting and scoring ability.'
  },
  'strong': {
    name: 'Strong',
    measures: 'Power Label',
    interpretation: 'Above-average combat performance.'
  },
  'passive': {
    name: 'Passive',
    measures: 'Power Label',
    interpretation: 'Less reliant on direct engagements.'
  },
  'weak': {
    name: 'Weak',
    measures: 'Power Label',
    interpretation: 'Struggles to generate impact through fights.'
  },

  // Placement Control Labels
  'dominant': {
    name: 'Dominant',
    measures: 'Placement Control Label',
    interpretation: 'Consistently achieves top placements.'
  },
  'controlled': {
    name: 'Controlled',
    measures: 'Placement Control Label',
    interpretation: 'Reliable placement performer.'
  },
  'stable': {
    name: 'Stable',
    measures: 'Placement Control Label',
    interpretation: 'Maintains respectable placement results.'
  },
  'unstable': {
    name: 'Unstable',
    measures: 'Placement Control Label',
    interpretation: 'Placement results vary significantly.'
  },
  'struggling': {
    name: 'Struggling',
    measures: 'Placement Control Label',
    interpretation: 'Difficulty securing strong placements.'
  },
  'solid': {
    name: 'Solid',
    measures: 'Placement Control Label',
    interpretation: 'Reliable, consistent placement performance.'
  },
  'developing': {
    name: 'Developing',
    measures: 'Placement Control Label',
    interpretation: 'Improving positioning and survival skills.'
  },

  // Conversion Labels
  'efficient': {
    name: 'Efficient',
    measures: 'Conversion Label',
    interpretation: 'Consistently capitalizes on strong positions.'
  },
  'average': {
    name: 'Average',
    measures: 'Conversion / Power Label',
    interpretation: 'Converts opportunities at a moderate rate, or average combat performance.'
  },
  'wasteful': {
    name: 'Wasteful',
    measures: 'Conversion Label',
    interpretation: 'Often fails to capitalize on strong positions.'
  },
  'poor': {
    name: 'Poor',
    measures: 'Conversion Label',
    interpretation: 'Rarely converts opportunities into wins.'
  },
  'excellent': {
    name: 'Excellent',
    measures: 'Conversion Label',
    interpretation: 'Highly effective at turning opportunities into match wins.'
  },
  'good': {
    name: 'Good',
    measures: 'Conversion Label',
    interpretation: 'Strong performance converting good placements into wins.'
  },
  'slayer': {
    name: 'Slayer',
    measures: 'Team/Player Identity',
    interpretation: 'Stands out through raw fighting power.'
  },
  'survivalist': {
    name: 'Survivalist',
    measures: 'Team/Player Identity',
    interpretation: 'Stands out through placement and positioning.'
  },
  'closer': {
    name: 'Closer',
    measures: 'Team/Player Identity',
    interpretation: 'Stands out through conversion, turning strong positions into wins.'
  },
  'complete team': {
    name: 'Complete Team',
    measures: 'Team Identity',
    interpretation: 'No single weak category, strong across all four.'
  },
  'complete player': {
    name: 'Complete Player',
    measures: 'Player Identity',
    interpretation: 'No single weak category, strong across all four.'
  },
  'momentum team': {
    name: 'Momentum Team',
    measures: 'Team Identity',
    interpretation: 'Defined by trajectory, Form stands out regardless of absolute level elsewhere.'
  },
  'momentum player': {
    name: 'Momentum Player',
    measures: 'Player Identity',
    interpretation: 'Defined by trajectory, Form stands out regardless of absolute level elsewhere.'
  },
  'dark horse': {
    name: 'Dark Horse',
    measures: 'Team/Player Identity',
    interpretation: 'Below-average overall rating but improving sharply.'
  },

  // Form Labels
  'red hot': {
    name: 'Red Hot',
    measures: 'Form Label',
    interpretation: 'Rapidly improving and performing at a high level.'
  },
  'in form': {
    name: 'In Form',
    measures: 'Form Label',
    interpretation: 'Showing positive performance trends.'
  },
  'steady': {
    name: 'Steady',
    measures: 'Form Label',
    interpretation: 'Maintaining consistent results.'
  },
  'inconsistent': {
    name: 'Inconsistent',
    measures: 'Form Label',
    interpretation: 'Performance fluctuates noticeably.'
  },
  'cold': {
    name: 'Cold',
    measures: 'Form Label',
    interpretation: 'Currently trending downward.'
  },
  'elite rank': {
    name: 'Elite Rank',
    measures: 'Team Rating Tier',
    interpretation: 'The highest tier — sustained excellence across Power, Placement, Conversion, and Form. Reached by roughly the top 3% of team performances.'
  },
  'top rank': {
    name: 'Top Rank',
    measures: 'Team Rating Tier',
    interpretation: 'A strong, tournament-contending level of performance, just below the very top tier.'
  },
  'pro rank': {
    name: 'Pro Rank',
    measures: 'Team Rating Tier',
    interpretation: 'A solid, competitive level of performance — clearly above average.'
  },
  'mid rank': {
    name: 'Mid Rank',
    measures: 'Team Rating Tier',
    interpretation: 'An average, developing level of performance.'
  },
  'low rank': {
    name: 'Low Rank',
    measures: 'Team Rating Tier',
    interpretation: 'A below-average level of performance, with room to grow.'
  },
  'entry rank': {
    name: 'Entry Rank',
    measures: 'Team Rating Tier',
    interpretation: 'A new or still-developing team with limited results so far.'
  }
};

const ALIASES = {
  'team rating': 'team_rating',
  'team rating (0-1000)': 'team_rating',
  'team rating (0–1000)': 'team_rating',
  'rating': 'team_rating',
  'overall': 'team_rating',
  
  'power': 'power',
  'power tier': 'power',
  
  'ppm': 'ppm',
  'ppm (points per match)': 'ppm',
  'avg ppm': 'ppm',
  
  'kpm': 'kpm',
  'kpm (kills per match)': 'kpm',
  'avg kpm': 'kpm',
  
  'kill%': 'kill_efficiency',
  'kill %': 'kill_efficiency',
  'kill efficiency': 'kill_efficiency',
  
  'placement control': 'placement_control',
  'placement': 'placement_control',
  'placement tier': 'placement_control',
  
  'avg placement': 'avg_placement',
  'avg place': 'avg_placement',
  
  'top 3 finish rate': 'top_3_finish_rate',
  'top3 rate%': 'top_3_finish_rate',
  'top 3 rate %': 'top_3_finish_rate',
  'top3 rate': 'top_3_finish_rate',
  'top 3 rate': 'top_3_finish_rate',
  'top 3 finish rate': 'top_3_finish_rate',
  
  'placement efficiency': 'placement_efficiency',
  'place eff%': 'placement_efficiency',
  
  'placement dominance': 'placement_dominance',
  
  'conversion': 'conversion',
  'conversion tier': 'conversion',
  
  'win rate': 'win_rate',
  'win rate%': 'win_rate',
  'win rate %': 'win_rate',
  
  'conversion rate': 'conversion_rate',
  'cr%': 'conversion_rate',
  'cr': 'conversion_rate',
  
  'form': 'form',
  
  'momentum index': 'momentum_index',
  'f.mi': 'momentum_index',
  'highest momentum': 'momentum_index',
  
  'consistency score': 'consistency_score',
  'st.dev cs': 'consistency_score',
  'consistency': 'consistency_score',
  'most consistent': 'consistency_score',
  
  'playstyle': 'playstyle',
  
  'dpm': 'dpm',
  'damage per match': 'dpm',
  'avg dpm': 'dpm',
  'top 5 finish rate': 'top_5_finish_rate',
  'top 5 rate %': 'top_5_finish_rate',
  'top5 rate': 'top_5_finish_rate',
  'top 5 rate': 'top_5_finish_rate',
  'top3vs5spread': 'top_3_vs_5_spread',
  'top 3 vs 5 spread': 'top_3_vs_5_spread'
};

export function getMetricDefinition(key) {
  if (!key) return null;
  const cleanKey = key.toString().trim().toLowerCase();
  
  // 1. Check labels
  if (LABELS[cleanKey]) {
    return LABELS[cleanKey];
  }
  
  // 2. Check aliases
  const mappedKey = ALIASES[cleanKey];
  if (mappedKey && DEFINITIONS[mappedKey]) {
    return DEFINITIONS[mappedKey];
  }
  
  // 3. Fallback to direct check in DEFINITIONS
  if (DEFINITIONS[cleanKey]) {
    return DEFINITIONS[cleanKey];
  }
  
  return null;
}
