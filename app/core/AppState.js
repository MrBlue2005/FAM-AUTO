const state = {
  robotStatus: 'idle',
  currentProperty: null,
  currentGroup: null,
  currentDay: 1,
  pauseRequested: false,

  progress: 0,
  totalGroups: 0,
  totalCampaignProgress: 0,
  totalCampaignGroups: 0,

  averageSecondsPerGroup: null,
  etaCurrentProperty: null,
  etaTotal: null,

  stopAfterCurrentGroup: false,
  activeRunId: null,

  liveFeed: [],
  lastMessage: 'Robot pregătit.',
};

function getState() {
  return state;
}

function updateState(partialState) {
  Object.assign(state, partialState);
  return state;
}

function addLiveFeed(event) {
  state.liveFeed = [
    {
      time: new Date().toLocaleTimeString('ro-RO'),
      ...event,
    },
    ...state.liveFeed,
  ].slice(0, 100);

  state.lastMessage = event.message || state.lastMessage;

  return state;
}

module.exports = {
  getState,
  updateState,
  addLiveFeed,
};
