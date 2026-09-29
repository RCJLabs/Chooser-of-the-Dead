# draft
// FIRST DRAFT (phase 6): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The shieldmaiden's choice (docs/tech-spec.md §72): Thurid would sell her sword to feed the house.
EXTERNAL home(id)
EXTERNAL sick(id)
{ not home("thurid"): -> gone }
Thurid's letters run to three lines. This one runs to five.
{ home("brother"):
  "I read your brother's letter over his shoulder. He won't ask you twice, so I'm asking for him." # speaker: thurid
}
"The smith in the valley will give twelve rings for my sword. It's robbery. He knows it, and I know it, and he knows I know it." # speaker: thurid
{ sick("thurid"):
  "I'm no use to it lying down anyway." # speaker: thurid
}
{ home("sister"):
  "A sword doesn't eat. Your sister does. Say yes and I take it down to him in the morning." # speaker: thurid
- else:
  "A sword doesn't eat. We do. Say yes and I take it down to him in the morning." # speaker: thurid
}
* [Tell her to sell it.]
  # fx: rings +12
  # fx: flag thurid_sold
  You write yes. By dawn the raven is back with twelve rings, wrapped in the strip of leather she wound round the grip.
* [Tell her to keep it.]
  # fx: flag thurid_kept
  You write no, and underline it, and underline it again. You'll find twelve rings somewhere. The world is ending, and she should have her sword when it does.
- You sleep with your right hand closed, the way you did on the wall.
-> END

=== gone ===
Nobody splits the wood at your mother's house now. You think of Thurid's sword, hanging by the door with nobody to oil it, and of the smith who would have given twelve rings for it, and would have been robbing her.
-> END
