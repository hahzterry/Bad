/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/shadowspace.json`.
 */
export type Shadowspace = {
  "address": "EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ",
  "metadata": {
    "name": "shadowspace",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ShadowSpace - Social on Solana"
  },
  "instructions": [
    {
      "name": "adminForceClose",
      "docs": [
        "Admin force-close: lets the upgrade authority close ANY program account",
        "and send rent to the authority. Used for devnet cleanup."
      ],
      "discriminator": [
        244,
        156,
        26,
        31,
        96,
        180,
        100,
        158
      ],
      "accounts": [
        {
          "name": "targetAccount",
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "The upgrade authority — hardcoded, only this wallet can force-close"
          ],
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "closeChat",
      "docs": [
        "Close a legacy chat account and return rent"
      ],
      "discriminator": [
        182,
        227,
        125,
        158,
        213,
        132,
        147,
        192
      ],
      "accounts": [
        {
          "name": "chat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "chatId"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury wallet — rent refund destination"
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "chatId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeComment",
      "docs": [
        "Close a comment account and return rent"
      ],
      "discriminator": [
        220,
        161,
        167,
        122,
        254,
        149,
        11,
        78
      ],
      "accounts": [
        {
          "name": "comment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "post"
              },
              {
                "kind": "arg",
                "path": "commentIndex"
              }
            ]
          }
        },
        {
          "name": "post",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "post.author",
                "account": "post"
              },
              {
                "kind": "arg",
                "path": "postId"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury wallet — rent refund destination"
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "postId",
          "type": "u64"
        },
        {
          "name": "commentIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeCommunity",
      "discriminator": [
        193,
        80,
        180,
        65,
        226,
        240,
        125,
        104
      ],
      "accounts": [
        {
          "name": "community",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  117,
                  110,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "communityId"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "communityId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeMessage",
      "docs": [
        "Close a legacy message account and return rent"
      ],
      "discriminator": [
        53,
        48,
        100,
        249,
        207,
        188,
        96,
        22
      ],
      "accounts": [
        {
          "name": "message",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  115,
                  115,
                  97,
                  103,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "chatId"
              },
              {
                "kind": "arg",
                "path": "messageIndex"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury wallet — rent refund destination"
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "chatId",
          "type": "u64"
        },
        {
          "name": "messageIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closePoll",
      "discriminator": [
        139,
        213,
        162,
        65,
        172,
        150,
        123,
        67
      ],
      "accounts": [
        {
          "name": "poll",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "poll.creator",
                "account": "poll"
              },
              {
                "kind": "arg",
                "path": "pollId"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "pollId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closePost",
      "docs": [
        "Close a post account and return rent to the author"
      ],
      "discriminator": [
        131,
        190,
        34,
        94,
        190,
        71,
        183,
        81
      ],
      "accounts": [
        {
          "name": "post",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "arg",
                "path": "postId"
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury wallet — rent refund destination"
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "postId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeProfile",
      "docs": [
        "Close a profile account and return rent to the owner"
      ],
      "discriminator": [
        167,
        36,
        181,
        8,
        136,
        158,
        46,
        207
      ],
      "accounts": [
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury wallet — rent refund destination"
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeReaction",
      "docs": [
        "Close a reaction account and return rent"
      ],
      "discriminator": [
        92,
        52,
        140,
        129,
        113,
        132,
        43,
        244
      ],
      "accounts": [
        {
          "name": "reaction",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "post"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "post",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "post.author",
                "account": "post"
              },
              {
                "kind": "arg",
                "path": "postId"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury wallet — rent refund destination"
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "postId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createChat",
      "discriminator": [
        133,
        186,
        254,
        72,
        143,
        178,
        221,
        28
      ],
      "accounts": [
        {
          "name": "chat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "chatId"
              }
            ]
          }
        },
        {
          "name": "user1",
          "writable": true,
          "signer": true
        },
        {
          "name": "user2"
        },
        {
          "name": "payer",
          "docs": [
            "Fee payer — treasury for gasless UX"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "chatId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createComment",
      "discriminator": [
        236,
        232,
        11,
        180,
        70,
        206,
        73,
        145
      ],
      "accounts": [
        {
          "name": "comment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "post"
              },
              {
                "kind": "arg",
                "path": "commentIndex"
              }
            ]
          }
        },
        {
          "name": "post",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "post.author",
                "account": "post"
              },
              {
                "kind": "arg",
                "path": "postId"
              }
            ]
          }
        },
        {
          "name": "commenterProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "commenter_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "author",
          "docs": [
            "The commenter — must be the commenter_profile owner"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "postId",
          "type": "u64"
        },
        {
          "name": "commentIndex",
          "type": "u64"
        },
        {
          "name": "content",
          "type": "string"
        }
      ]
    },
    {
      "name": "createCommunity",
      "discriminator": [
        203,
        214,
        176,
        194,
        13,
        207,
        22,
        60
      ],
      "accounts": [
        {
          "name": "community",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  117,
                  110,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "communityId"
              }
            ]
          }
        },
        {
          "name": "creatorProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "communityId",
          "type": "u64"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "avatarUrl",
          "type": "string"
        }
      ]
    },
    {
      "name": "createPoll",
      "discriminator": [
        182,
        171,
        112,
        238,
        6,
        219,
        14,
        110
      ],
      "accounts": [
        {
          "name": "poll",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "profile.owner",
                "account": "profile"
              },
              {
                "kind": "arg",
                "path": "pollId"
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "pollId",
          "type": "u64"
        },
        {
          "name": "question",
          "type": "string"
        },
        {
          "name": "optionA",
          "type": "string"
        },
        {
          "name": "optionB",
          "type": "string"
        },
        {
          "name": "optionC",
          "type": "string"
        },
        {
          "name": "optionD",
          "type": "string"
        },
        {
          "name": "numOptions",
          "type": "u8"
        },
        {
          "name": "endsAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "createPost",
      "discriminator": [
        123,
        92,
        184,
        29,
        231,
        24,
        15,
        202
      ],
      "accounts": [
        {
          "name": "post",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "profile.owner",
                "account": "profile"
              },
              {
                "kind": "arg",
                "path": "postId"
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "author",
          "docs": [
            "The post author — must be the profile owner"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "postId",
          "type": "u64"
        },
        {
          "name": "content",
          "type": "string"
        },
        {
          "name": "isPrivate",
          "type": "bool"
        }
      ]
    },
    {
      "name": "createProfile",
      "discriminator": [
        225,
        205,
        234,
        143,
        17,
        186,
        50,
        220
      ],
      "accounts": [
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Fee payer — can be a server keypair for gasless UX"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "username",
          "type": "string"
        },
        {
          "name": "displayName",
          "type": "string"
        },
        {
          "name": "bio",
          "type": "string"
        }
      ]
    },
    {
      "name": "followUser",
      "discriminator": [
        126,
        176,
        97,
        36,
        63,
        145,
        4,
        134
      ],
      "accounts": [
        {
          "name": "followAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  111,
                  108,
                  108,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "follower_profile.owner",
                "account": "profile"
              },
              {
                "kind": "account",
                "path": "following_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "followerProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "followingProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "following_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Fee payer — can be a server keypair for gasless UX"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "joinCommunity",
      "discriminator": [
        252,
        106,
        147,
        30,
        134,
        74,
        28,
        232
      ],
      "accounts": [
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114,
                  115,
                  104,
                  105,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "community"
              },
              {
                "kind": "account",
                "path": "member_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "community",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  117,
                  110,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "communityId"
              }
            ]
          }
        },
        {
          "name": "memberProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "communityId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "leaveCommunity",
      "discriminator": [
        218,
        140,
        41,
        66,
        8,
        140,
        33,
        161
      ],
      "accounts": [
        {
          "name": "membership",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114,
                  115,
                  104,
                  105,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "community"
              },
              {
                "kind": "account",
                "path": "member_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "community",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  117,
                  110,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "communityId"
              }
            ]
          }
        },
        {
          "name": "memberProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "communityId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "likePost",
      "discriminator": [
        45,
        242,
        154,
        71,
        63,
        133,
        54,
        186
      ],
      "accounts": [
        {
          "name": "post",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "post.author",
                "account": "post"
              },
              {
                "kind": "arg",
                "path": "postId"
              }
            ]
          }
        },
        {
          "name": "profile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "likeRecord",
          "docs": [
            "One LikeRecord PDA per (post, liker) — init will fail if they've already liked"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "post"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "docs": [
            "The liker — must be the profile owner (read-only, no SOL needed)"
          ],
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Treasury pays for like_record rent"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "postId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "migrateProfile",
      "docs": [
        "Resize an existing profile account to the current schema size.",
        "This is needed when the Profile struct grows (e.g. adding follower/following counts)."
      ],
      "discriminator": [
        224,
        187,
        132,
        189,
        185,
        163,
        183,
        237
      ],
      "accounts": [
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "reactToPost",
      "discriminator": [
        186,
        193,
        53,
        26,
        172,
        69,
        217,
        231
      ],
      "accounts": [
        {
          "name": "reaction",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "post"
              },
              {
                "kind": "account",
                "path": "reactor_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "post",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "post.author",
                "account": "post"
              },
              {
                "kind": "arg",
                "path": "postId"
              }
            ]
          }
        },
        {
          "name": "reactorProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "reactor_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "user",
          "docs": [
            "The reactor — must be the reactor_profile owner"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "postId",
          "type": "u64"
        },
        {
          "name": "reactionType",
          "type": "u8"
        }
      ]
    },
    {
      "name": "sendMessage",
      "discriminator": [
        57,
        40,
        34,
        178,
        189,
        10,
        65,
        26
      ],
      "accounts": [
        {
          "name": "message",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  115,
                  115,
                  97,
                  103,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "chatId"
              },
              {
                "kind": "arg",
                "path": "messageIndex"
              }
            ]
          }
        },
        {
          "name": "chat",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "chatId"
              }
            ]
          }
        },
        {
          "name": "sender",
          "docs": [
            "Message sender — must be a participant in the chat"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Fee payer — treasury for gasless UX"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "chatId",
          "type": "u64"
        },
        {
          "name": "messageIndex",
          "type": "u64"
        },
        {
          "name": "content",
          "type": "string"
        },
        {
          "name": "isPayment",
          "type": "bool"
        },
        {
          "name": "paymentAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unfollowUser",
      "discriminator": [
        204,
        183,
        196,
        110,
        97,
        165,
        226,
        213
      ],
      "accounts": [
        {
          "name": "followAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  111,
                  108,
                  108,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "follower_profile.owner",
                "account": "profile"
              },
              {
                "kind": "account",
                "path": "following_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "followerProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "followingProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "following_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury wallet — rent refund destination"
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "updateCommunity",
      "discriminator": [
        250,
        158,
        38,
        207,
        116,
        171,
        210,
        51
      ],
      "accounts": [
        {
          "name": "community",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  117,
                  110,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "communityId"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "communityId",
          "type": "u64"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "avatarUrl",
          "type": "string"
        }
      ]
    },
    {
      "name": "updateProfile",
      "discriminator": [
        98,
        67,
        99,
        206,
        86,
        115,
        175,
        1
      ],
      "accounts": [
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Fee payer — treasury pays for realloc rent in gasless UX"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "displayName",
          "type": "string"
        },
        {
          "name": "bio",
          "type": "string"
        },
        {
          "name": "avatarUrl",
          "type": "string"
        },
        {
          "name": "bannerUrl",
          "type": "string"
        }
      ]
    },
    {
      "name": "votePoll",
      "discriminator": [
        154,
        219,
        48,
        148,
        149,
        7,
        153,
        194
      ],
      "accounts": [
        {
          "name": "poll",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "poll.creator",
                "account": "poll"
              },
              {
                "kind": "arg",
                "path": "pollId"
              }
            ]
          }
        },
        {
          "name": "pollVote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  108,
                  95,
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "poll"
              },
              {
                "kind": "account",
                "path": "voter_profile.owner",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "voterProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "pollId",
          "type": "u64"
        },
        {
          "name": "choice",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "chat",
      "discriminator": [
        170,
        4,
        71,
        128,
        185,
        103,
        250,
        177
      ]
    },
    {
      "name": "comment",
      "discriminator": [
        150,
        135,
        96,
        244,
        55,
        199,
        50,
        65
      ]
    },
    {
      "name": "community",
      "discriminator": [
        192,
        73,
        211,
        158,
        178,
        81,
        19,
        112
      ]
    },
    {
      "name": "followAccount",
      "discriminator": [
        174,
        177,
        136,
        60,
        138,
        84,
        148,
        209
      ]
    },
    {
      "name": "membership",
      "discriminator": [
        231,
        141,
        180,
        98,
        109,
        168,
        175,
        166
      ]
    },
    {
      "name": "message",
      "discriminator": [
        110,
        151,
        23,
        110,
        198,
        6,
        125,
        181
      ]
    },
    {
      "name": "poll",
      "discriminator": [
        110,
        234,
        167,
        188,
        231,
        136,
        153,
        111
      ]
    },
    {
      "name": "pollVote",
      "discriminator": [
        60,
        154,
        212,
        155,
        112,
        25,
        150,
        182
      ]
    },
    {
      "name": "post",
      "discriminator": [
        8,
        147,
        90,
        186,
        185,
        56,
        192,
        150
      ]
    },
    {
      "name": "profile",
      "discriminator": [
        184,
        101,
        165,
        188,
        95,
        63,
        127,
        188
      ]
    },
    {
      "name": "reaction",
      "discriminator": [
        226,
        61,
        100,
        191,
        223,
        221,
        142,
        139
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadyFollowing",
      "msg": "Already following this user"
    },
    {
      "code": 6001,
      "name": "notFollowing",
      "msg": "Not following this user"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6003,
      "name": "contentTooLong",
      "msg": "Content too long"
    },
    {
      "code": 6004,
      "name": "cannotFollowSelf",
      "msg": "Cannot follow yourself"
    },
    {
      "code": 6005,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6006,
      "name": "communityFull",
      "msg": "Community is full (max 100 members)"
    },
    {
      "code": 6007,
      "name": "alreadyInitialized",
      "msg": "Account already initialized"
    },
    {
      "code": 6008,
      "name": "invalidPollOptions",
      "msg": "Poll must have 2-4 options"
    },
    {
      "code": 6009,
      "name": "invalidPollChoice",
      "msg": "Invalid poll choice"
    },
    {
      "code": 6010,
      "name": "pollAlreadyEnded",
      "msg": "Poll has ended"
    }
  ],
  "types": [
    {
      "name": "chat",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "chatId",
            "type": "u64"
          },
          {
            "name": "user1",
            "type": "pubkey"
          },
          {
            "name": "user2",
            "type": "pubkey"
          },
          {
            "name": "messageCount",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "comment",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "post",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "commentIndex",
            "type": "u64"
          },
          {
            "name": "content",
            "type": "string"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "community",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "communityId",
            "type": "u64"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "avatarUrl",
            "type": "string"
          },
          {
            "name": "memberCount",
            "type": "u32"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "followAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "follower",
            "type": "pubkey"
          },
          {
            "name": "following",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "membership",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "community",
            "type": "pubkey"
          },
          {
            "name": "member",
            "type": "pubkey"
          },
          {
            "name": "joinedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "message",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "chatId",
            "type": "u64"
          },
          {
            "name": "messageIndex",
            "type": "u64"
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "content",
            "type": "string"
          },
          {
            "name": "isPayment",
            "type": "bool"
          },
          {
            "name": "paymentAmount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "poll",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "pollId",
            "type": "u64"
          },
          {
            "name": "question",
            "type": "string"
          },
          {
            "name": "optionA",
            "type": "string"
          },
          {
            "name": "optionB",
            "type": "string"
          },
          {
            "name": "optionC",
            "type": "string"
          },
          {
            "name": "optionD",
            "type": "string"
          },
          {
            "name": "numOptions",
            "type": "u8"
          },
          {
            "name": "votesA",
            "type": "u32"
          },
          {
            "name": "votesB",
            "type": "u32"
          },
          {
            "name": "votesC",
            "type": "u32"
          },
          {
            "name": "votesD",
            "type": "u32"
          },
          {
            "name": "totalVotes",
            "type": "u32"
          },
          {
            "name": "endsAt",
            "type": "i64"
          },
          {
            "name": "isClosed",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pollVote",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poll",
            "type": "pubkey"
          },
          {
            "name": "voter",
            "type": "pubkey"
          },
          {
            "name": "choice",
            "type": "u8"
          },
          {
            "name": "votedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "post",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "postId",
            "type": "u64"
          },
          {
            "name": "content",
            "type": "string"
          },
          {
            "name": "isPrivate",
            "type": "bool"
          },
          {
            "name": "likes",
            "type": "u32"
          },
          {
            "name": "commentCount",
            "type": "u32"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "profile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "username",
            "type": "string"
          },
          {
            "name": "displayName",
            "type": "string"
          },
          {
            "name": "bio",
            "type": "string"
          },
          {
            "name": "isPrivate",
            "type": "bool"
          },
          {
            "name": "postCount",
            "type": "u32"
          },
          {
            "name": "followerCount",
            "type": "u32"
          },
          {
            "name": "followingCount",
            "type": "u32"
          },
          {
            "name": "activeConversationCount",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "avatarUrl",
            "type": "string"
          },
          {
            "name": "bannerUrl",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "reaction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "post",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "reactionType",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
