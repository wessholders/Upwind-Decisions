// Captured from unmodified revision 1f9a90f before the Phase 1 refactor.
// Numeric results are checked with tolerance; actions, times and explanations are exact.
export const LEGACY_RACES = [
  {
    "name": "steady-port",
    "config": {
      "courseLength": 100,
      "windMode": "steady"
    },
    "commands": [
      {
        "time": 0,
        "action": "tack"
      },
      {
        "time": 34,
        "action": "tack"
      },
      {
        "time": 40,
        "action": "bear"
      }
    ],
    "finish": {
      "position": {
        "x": 5.112021916886533e-13,
        "y": 104.16600061993357
      },
      "time": 63.68149486434868,
      "tack": "starboard",
      "mode": "gate",
      "penaltyRemaining": 0,
      "penaltyTime": 9,
      "tackManeuver": null,
      "speedKnots": 4.938159837698289,
      "distance": 150.94422554285197,
      "tacks": 2,
      "finished": true,
      "markAimDistance": 4.166000619933962
    },
    "decisions": [
      {
        "time": 0,
        "action": "tack",
        "reason": "Similar current-wind estimates; taking the right-hand leg to set up a starboard finish.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": 0,
          "y": 0
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 121.60000000000018,
            "averageWindKnots": 10,
            "position": {
              "x": -100.39973483807422,
              "y": 100.39973483807422
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 115.78772781883198,
            "averageWindKnots": 10,
            "position": {
              "x": 92.01255487264852,
              "y": 100.21851927796793
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 34,
        "action": "tack",
        "reason": "Reached a clearance-safe starboard approach to the mark; tacking to leave it to port and cross the windward line.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 48.50600310948294,
          "y": 56.71196751480234
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      },
      {
        "time": 40,
        "action": "bear",
        "reason": "A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to port.",
        "fromTack": "starboard",
        "toTack": "starboard",
        "position": {
          "x": 46.74635965103461,
          "y": 66.67757537857008
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      }
    ]
  },
  {
    "name": "steady-starboard",
    "config": {
      "courseLength": 100,
      "courseMode": "round-starboard",
      "windMode": "steady"
    },
    "commands": [
      {
        "time": 32,
        "action": "tack"
      },
      {
        "time": 38,
        "action": "bear"
      }
    ],
    "finish": {
      "position": {
        "x": 5.76594327839075e-13,
        "y": 104.13041892020989
      },
      "time": 63.90605182542352,
      "tack": "port",
      "mode": "gate",
      "penaltyRemaining": 0,
      "penaltyTime": 4.5,
      "tackManeuver": null,
      "speedKnots": 4.956749603479336,
      "distance": 153.99869315478293,
      "tacks": 1,
      "finished": true,
      "markAimDistance": 4.1304189202094514
    },
    "decisions": [
      {
        "time": 32,
        "action": "tack",
        "reason": "Reached a clearance-safe port approach to the mark; tacking to leave it to starboard and cross the windward line.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": -53.54652524697283,
          "y": 53.54652524697283
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      },
      {
        "time": 38,
        "action": "bear",
        "reason": "A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to starboard.",
        "fromTack": "port",
        "toTack": "port",
        "position": {
          "x": -51.7868817885245,
          "y": 63.51213311074056
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      }
    ]
  },
  {
    "name": "fixed-finish",
    "config": {
      "courseMode": "finish-upwind",
      "windMode": "steady"
    },
    "commands": [
      {
        "time": 284,
        "action": "tack"
      }
    ],
    "finish": {
      "position": {
        "x": 41.34321246091097,
        "y": 1000
      },
      "time": 597.7194365143754,
      "tack": "port",
      "mode": "close",
      "penaltyRemaining": 0,
      "penaltyTime": 4.5,
      "tackManeuver": null,
      "speedKnots": 4.6,
      "distance": 1412.5766843203878,
      "tacks": 1,
      "finished": true,
      "markAimDistance": null
    },
    "decisions": [
      {
        "time": 284,
        "action": "tack",
        "reason": "The opposite tack now reaches the finite finish line in the current wind.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": -475.22541156688544,
          "y": 475.22541156688544
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      }
    ]
  },
  {
    "name": "oscillating-42",
    "config": {
      "courseLength": 300,
      "windMode": "oscillating",
      "seed": 42
    },
    "commands": [
      {
        "time": 0,
        "action": "tack"
      },
      {
        "time": 86,
        "action": "tack"
      },
      {
        "time": 96,
        "action": "bear"
      }
    ],
    "finish": {
      "position": {
        "x": 0.8418320266957099,
        "y": 304.5096179067695
      },
      "time": 172.42366812396995,
      "tack": "starboard",
      "mode": "gate",
      "penaltyRemaining": 0,
      "penaltyTime": 9,
      "tackManeuver": null,
      "speedKnots": 4.960256754767827,
      "distance": 415.5340137987513,
      "tacks": 2,
      "finished": true,
      "markAimDistance": 4.58751946330778
    },
    "decisions": [
      {
        "time": 0,
        "action": "tack",
        "reason": "Similar current-wind estimates; taking the right-hand leg to set up a starboard finish.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": 0,
          "y": 0
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 182.82557822832032,
            "averageWindKnots": 10,
            "position": {
              "x": -100.39973483807422,
              "y": 100.39973483807422
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 182.13387466579513,
            "averageWindKnots": 10,
            "position": {
              "x": 92.01255487264852,
              "y": 100.21851927796793
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 86,
        "action": "tack",
        "reason": "The other tack has the better estimated route to the gate in the current wind, including tack costs.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 135.71155418640834,
          "y": 143.5297974631859
        },
        "wind": {
          "direction": 1.3709451303026867,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 204.11672885095618,
            "averageWindKnots": 10,
            "position": {
              "x": 238.4846357604794,
              "y": 241.49870689306192
            },
            "tack": "port"
          },
          {
            "action": "tack",
            "estimatedSeconds": 93.5917010082658,
            "averageWindKnots": 10,
            "position": {
              "x": 46.12308827630555,
              "y": 245.92105019668045
            },
            "tack": "starboard"
          }
        ]
      },
      {
        "time": 96,
        "action": "bear",
        "reason": "A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to port.",
        "fromTack": "starboard",
        "toTack": "starboard",
        "position": {
          "x": 128.06426516902744,
          "y": 160.52055664848385
        },
        "wind": {
          "direction": 3.535028812669111,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      }
    ]
  },
  {
    "name": "traveling-shift",
    "config": {
      "courseLength": 300,
      "windField": "traveling",
      "windMode": "persistent",
      "persistentShiftAngle": -12
    },
    "commands": [
      {
        "time": 0,
        "action": "tack"
      },
      {
        "time": 94,
        "action": "tack"
      },
      {
        "time": 100,
        "action": "bear"
      },
      {
        "time": 170,
        "action": "tack"
      },
      {
        "time": 188,
        "action": "tack"
      },
      {
        "time": 194,
        "action": "bear"
      }
    ],
    "finish": {
      "position": {
        "x": -0.6977499130520806,
        "y": 303.2826552498325
      },
      "time": 201.67164997287819,
      "tack": "starboard",
      "mode": "gate",
      "penaltyRemaining": 0,
      "penaltyTime": 18,
      "tackManeuver": null,
      "speedKnots": 5.611236129406782,
      "distance": 473.42919422927486,
      "tacks": 4,
      "finished": true,
      "markAimDistance": 3.3559917208504806
    },
    "decisions": [
      {
        "time": 0,
        "action": "tack",
        "reason": "Similar current-wind estimates; taking the right-hand leg to set up a starboard finish.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": 0,
          "y": 0
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 182.82557822832032,
            "averageWindKnots": 10,
            "position": {
              "x": -100.39973483807422,
              "y": 100.39973483807422
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 182.13387466579513,
            "averageWindKnots": 10,
            "position": {
              "x": 92.01255487264852,
              "y": 100.21851927796793
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 94,
        "action": "tack",
        "reason": "Reached a clearance-safe starboard approach to the mark; tacking to leave it to port and cross the windward line.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 148.90573794755736,
          "y": 157.11170235287676
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      },
      {
        "time": 100,
        "action": "bear",
        "reason": "A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to port.",
        "fromTack": "starboard",
        "toTack": "starboard",
        "position": {
          "x": 147.13969649432886,
          "y": 167.07088085801152
        },
        "wind": {
          "direction": 359.5393070331688,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      },
      {
        "time": 170,
        "action": "tack",
        "reason": "The other tack has the better estimated route to the gate in the current wind, including tack costs.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": 9.773999453786928,
          "y": 259.17321351779265
        },
        "wind": {
          "direction": 348,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 120.9593322280071,
            "averageWindKnots": 10,
            "position": {
              "x": -109.30603892022415,
              "y": 336.50469463612353
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 116.42839559082465,
            "averageWindKnots": 10,
            "position": {
              "x": 78.93925744552136,
              "y": 376.3322035586597
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 188,
        "action": "tack",
        "reason": "Reached a clearance-safe starboard approach to the mark; tacking to leave it to port and cross the windward line.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 24.80722066268706,
          "y": 292.97617669685417
        },
        "wind": {
          "direction": 348,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      },
      {
        "time": 194,
        "action": "bear",
        "reason": "A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to port.",
        "fromTack": "starboard",
        "toTack": "starboard",
        "position": {
          "x": 21.014063254676792,
          "y": 302.3581616719685
        },
        "wind": {
          "direction": 348,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      }
    ]
  },
  {
    "name": "organic-314159",
    "config": {
      "courseLength": 300,
      "windField": "organic",
      "seed": 314159
    },
    "commands": [
      {
        "time": 32,
        "action": "tack"
      },
      {
        "time": 124,
        "action": "tack"
      },
      {
        "time": 130,
        "action": "bear"
      }
    ],
    "finish": {
      "position": {
        "x": -1.6209256159527285e-13,
        "y": 304.3663761731231
      },
      "time": 179.29862627950212,
      "tack": "starboard",
      "mode": "gate",
      "penaltyRemaining": 0,
      "penaltyTime": 9,
      "tackManeuver": null,
      "speedKnots": 4.78606578356578,
      "distance": 428.77988274521334,
      "tacks": 2,
      "finished": true,
      "markAimDistance": 4.366376173122947
    },
    "decisions": [
      {
        "time": 32,
        "action": "tack",
        "reason": "The other tack has the better estimated route to the gate in the current wind, including tack costs.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": -52.8700186694617,
          "y": 56.6846443753701
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 153.20558981710874,
            "averageWindKnots": 10.002432233136403,
            "position": {
              "x": -153.28628212205138,
              "y": 157.12154730878862
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 148.2284254401692,
            "averageWindKnots": 10.001934487504558,
            "position": {
              "x": 39.146670668611854,
              "y": 156.9534878082783
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 124,
        "action": "tack",
        "reason": "Reached a clearance-safe starboard approach to the mark; tacking to leave it to port and cross the windward line.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 91.95825283922196,
          "y": 213.47330021844988
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      },
      {
        "time": 130,
        "action": "bear",
        "reason": "A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to port.",
        "fromTack": "starboard",
        "toTack": "starboard",
        "position": {
          "x": 90.19860938077416,
          "y": 223.43890808221713
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      }
    ]
  },
  {
    "name": "organic-kilometer",
    "config": {
      "courseLength": 1000,
      "windField": "organic",
      "seed": 314159
    },
    "commands": [
      {
        "time": 0,
        "action": "tack"
      },
      {
        "time": 90,
        "action": "tack"
      },
      {
        "time": 178,
        "action": "tack"
      },
      {
        "time": 324,
        "action": "tack"
      },
      {
        "time": 478,
        "action": "tack"
      },
      {
        "time": 498,
        "action": "tack"
      },
      {
        "time": 524,
        "action": "tack"
      },
      {
        "time": 566,
        "action": "tack"
      },
      {
        "time": 572,
        "action": "bear"
      }
    ],
    "finish": {
      "position": {
        "x": -1.0195178035132813e-12,
        "y": 1004.2046128827209
      },
      "time": 597.7131336022676,
      "tack": "starboard",
      "mode": "gate",
      "penaltyRemaining": 0,
      "penaltyTime": 36,
      "tackManeuver": null,
      "speedKnots": 4.918614867735587,
      "distance": 1408.0242910856387,
      "tacks": 8,
      "finished": true,
      "markAimDistance": 4.204612882720121
    },
    "decisions": [
      {
        "time": 0,
        "action": "tack",
        "reason": "Similar current-wind estimates; taking the right-hand leg to set up a starboard finish.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": 0,
          "y": 0
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 601.1533762821516,
            "averageWindKnots": 10,
            "position": {
              "x": -100.39973483807422,
              "y": 100.39973483807422
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 599.005314542277,
            "averageWindKnots": 10.016346123478549,
            "position": {
              "x": 91.73954930674509,
              "y": 100.53766896264719
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 90,
        "action": "tack",
        "reason": "The other tack has the better estimated route to the gate in the current wind, including tack costs.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 144.97181162077834,
          "y": 148.72196382521486
        },
        "wind": {
          "direction": 9.216532731602513,
          "speedKnots": 13.06009301497505,
          "kind": "puff"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 510.70711099903343,
            "averageWindKnots": 11.900021160571107,
            "position": {
              "x": 261.4183504029019,
              "y": 242.38515692081705
            },
            "tack": "port"
          },
          {
            "action": "tack",
            "estimatedSeconds": 506.49936501592975,
            "averageWindKnots": 10.98014245031481,
            "position": {
              "x": 56.913566275609824,
              "y": 256.10970245053784
            },
            "tack": "starboard"
          }
        ]
      },
      {
        "time": 178,
        "action": "tack",
        "reason": "The current wind map predicts 0.4 kn more pressure on the other tack over the next minute.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": 7.738925310682646,
          "y": 297.04477149388737
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 423.63574862974275,
            "averageWindKnots": 10.000052119733082,
            "position": {
              "x": -92.66043047386083,
              "y": 397.4451139278374
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 399.70755211696786,
            "averageWindKnots": 10.41581285009579,
            "position": {
              "x": 104.14359039099033,
              "y": 394.51111006411435
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 324,
        "action": "tack",
        "reason": "The current wind map predicts 0.5 kn more pressure on the other tack over the next minute.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 243.65776678457036,
          "y": 541.1695773730929
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 298.23954718139674,
            "averageWindKnots": 9.422339470972737,
            "position": {
              "x": 339.9655493926284,
              "y": 638.5638087749255
            },
            "tack": "port"
          },
          {
            "action": "tack",
            "estimatedSeconds": 277.7053583618392,
            "averageWindKnots": 9.95877538298464,
            "position": {
              "x": 151.86424272935042,
              "y": 641.0938046995996
            },
            "tack": "starboard"
          }
        ]
      },
      {
        "time": 478,
        "action": "tack",
        "reason": "The other tack has the better estimated route to the gate in the current wind, including tack costs.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": -5.647706001060547,
          "y": 798.6810145640417
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 125.14949182642522,
            "averageWindKnots": 10,
            "position": {
              "x": -106.04744083913481,
              "y": 899.0807494021161
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 123.1531588399813,
            "averageWindKnots": 10,
            "position": {
              "x": 86.36484887158787,
              "y": 898.8995338420098
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 498,
        "action": "tack",
        "reason": "The current wind map predicts 0.6 kn more pressure on the other tack over the next minute.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 19.431692312870805,
          "y": 831.9663772832909
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 133.61862096764509,
            "averageWindKnots": 10.143729281553892,
            "position": {
              "x": 122.22353457431667,
              "y": 930.6654621033684
            },
            "tack": "port"
          },
          {
            "action": "tack",
            "estimatedSeconds": 99.5410094787261,
            "averageWindKnots": 10.789811960717657,
            "position": {
              "x": -63.93825839256005,
              "y": 943.5700243022739
            },
            "tack": "starboard"
          }
        ]
      },
      {
        "time": 524,
        "action": "tack",
        "reason": "The other tack has the better estimated route to the gate in the current wind, including tack costs.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": -10.017833097929005,
          "y": 882.9407461287793
        },
        "wind": {
          "direction": 0.030167940508192714,
          "speedKnots": 10.003591911983541,
          "kind": "puff"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 127.2711949657673,
            "averageWindKnots": 10.047504724697593,
            "position": {
              "x": -109.88950935104153,
              "y": 984.1823162507739
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 110.0189151172605,
            "averageWindKnots": 10.022793372543367,
            "position": {
              "x": 82.3594337798437,
              "y": 983.1216051354759
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 566,
        "action": "tack",
        "reason": "Reached a clearance-safe starboard approach to the mark; tacking to leave it to port and cross the windward line.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 51.87020198119324,
          "y": 953.1077391600309
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      },
      {
        "time": 572,
        "action": "bear",
        "reason": "A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to port.",
        "fromTack": "starboard",
        "toTack": "starboard",
        "position": {
          "x": 50.11055852274523,
          "y": 963.0733470237988
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      }
    ]
  },
  {
    "name": "cross-current",
    "config": {
      "courseLength": 200,
      "windMode": "steady",
      "current": {
        "enabled": true,
        "speedKnots": 0.35,
        "directionDegrees": 115
      }
    },
    "commands": [
      {
        "time": 0,
        "action": "tack"
      },
      {
        "time": 62,
        "action": "tack"
      },
      {
        "time": 68,
        "action": "bear"
      }
    ],
    "finish": {
      "position": {
        "x": -3.9143688290721457e-13,
        "y": 204.41058912874834
      },
      "time": 129.62656988394374,
      "tack": "starboard",
      "mode": "gate",
      "penaltyRemaining": 0,
      "penaltyTime": 9,
      "tackManeuver": null,
      "speedKnots": 4.823061443232711,
      "distance": 302.470568852706,
      "tacks": 2,
      "finished": true,
      "markAimDistance": 4.410589128747965
    },
    "decisions": [
      {
        "time": 0,
        "action": "tack",
        "reason": "Similar current-wind estimates; taking the right-hand leg to set up a starboard finish.",
        "fromTack": "starboard",
        "toTack": "port",
        "position": {
          "x": 0,
          "y": 0
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": [
          {
            "action": "hold",
            "estimatedSeconds": 125.79296900903601,
            "averageWindKnots": 10,
            "position": {
              "x": -90.60858971212156,
              "y": 95.83404888373478
            },
            "tack": "starboard"
          },
          {
            "action": "tack",
            "estimatedSeconds": 125.10126544651082,
            "averageWindKnots": 10,
            "position": {
              "x": 101.8036999986006,
              "y": 95.65283332362847
            },
            "tack": "port"
          }
        ]
      },
      {
        "time": 62,
        "action": "tack",
        "reason": "Reached a clearance-safe starboard approach to the mark; tacking to leave it to port and cross the windward line.",
        "fromTack": "port",
        "toTack": "starboard",
        "position": {
          "x": 105.47672933073483,
          "y": 98.84730161975293
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      },
      {
        "time": 68,
        "action": "bear",
        "reason": "A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to port.",
        "fromTack": "starboard",
        "toTack": "starboard",
        "position": {
          "x": 104.69620038488166,
          "y": 108.35634088808685
        },
        "wind": {
          "direction": 0,
          "speedKnots": 10,
          "kind": "background"
        },
        "options": []
      }
    ]
  }
];
