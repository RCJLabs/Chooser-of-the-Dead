# draft
// FIRST DRAFT (game phase 12): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
EXTERNAL flag(name)
EXTERNAL home(id)
-> pass

// Choose the slain (docs/tech-spec.md §78): before the gate opens, Skögul takes you over the levy's fight at the pass
// to choose who falls, as she and Göndul chose King Hákon in Hákonarmál. Whoever falls is in today's line. The first
// option is the one the drafts had fixed: Solveig's boy.
=== pass ===
Skögul wakes you in the dark. Outside there are two horses, saddled, standing on nothing in particular. # beat
By first light you're over the pass. The jarl's levy holds the narrow part three shields deep, and the men coming up the other side keep coming.
"The line holds this morning. It holds because one of them goes. Odin wants the best of them. You choose." # speaker: skogul
"I did this for a king once. Hákon, at Fitjar. He asked me why. They always ask why." # speaker: skogul
She points with her spear, one man at a time.
"Solveig's boy, at the front, with his father's spear. He isn't trying to come home." # speaker: skogul
{ flag("ulf_levy") && home("brother"):
  "Your brother, three shields down. He keeps looking along the line at the boy." # speaker: skogul
}
"Bera's man, Aslak, at the back, where it's narrowest. He stood here thirty winters ago. He knows where to put his feet." # speaker: skogul
* [Kari.]
  # fx: flag chose_kari
  You point. The next spear over the shields finds him, and the line closes over the gap as if it had practised. It holds.
  "That's the one he'd have taken himself. He likes them young." # speaker: skogul
* { flag("ulf_levy") && home("brother") } [Ulf.]
  # fx: flag chose_ulf
  # fx: standing odin +2
  # fx: family brother gone
  Your arm doesn't want to lift. It lifts. Ulf looks up, the way he did when you called him in from the yard, and then the spear finds him, and the line holds.
  Skögul is quiet for a long time.
  "Odin will know what that cost. He keeps count of that kind of thing." # speaker: skogul
* [Aslak.]
  # fx: flag chose_aslak
  # fx: standing odin -1
  You point. The old man goes down where the pass is narrowest, and the line steps over him and holds.
  "Odin asked for the best of them, and you gave him the oldest. He'll notice. The valley keeps its boy." # speaker: skogul
* [I won't choose.]
  # fx: flag chose_none
  # fx: standing odin -1
  Skögul doesn't argue. She points her spear at the front of the line, and the next spear over the shields finds Solveig's boy.
  "That's what happens when nobody chooses. The bravest go first. They always have." # speaker: skogul
- The horses turn for home. By the time the sun clears the ridge you're back at the gate, and the queue is already coming up the path.
-> decree

=== decree ===
"Liars," says Skögul, and puts the decree in front of you as if it's something she found in her boot. # speaker: skogul
"From today, a soul the halls would take, Valhalla or Freyja's field, goes to Hel if it lies to you. Aloud or on a forged tally. It doesn't matter what the lie was about." # speaker: skogul
"Until you catch one, they're honest. So catch them. Every contradiction you've let slide is somebody's whole eternity now." # speaker: skogul
"Odin thinks the ones who lie at the gate will run at the battle. He may be right. He usually is, about running." # speaker: skogul
Halfway down the queue, a broad man with a braided beard is waving at you cheerfully with both hands.
{ flag("thorvald_met"):
  You'd know him anywhere. He's the only soul on the path with any colour in his face.
- else:
  He's the only soul on the path with any colour in his face.
}
-> END
