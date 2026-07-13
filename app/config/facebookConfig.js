module.exports = {

    campaign: {

        currentDay: 1

    },

    human: {

        mode: "normal"

    },

pause: {
  short: {
    min: 1,
    max: 2
  },

  medium: {
    min: 2,
    max: 4
  },

  long: {
    min: 5,
    max: 8
  },

  betweenGroups: {
    min: 8,
    max: 18
  },

  longPauseEvery: {
    min: 8,
    max: 12
  },

  longPause: {
    min: 60,
    max: 120
  },

  microBreak: {
    probability: 0.05,
    min: 5,
    max: 10
  }
},

    typing: {

        minDelay: 70,

        maxDelay: 130

    },

    scroll: {

        probability: 0.35,

        minPixels: 200,

        maxPixels: 900

    },

    publish: {

        enabled: false

    }

};