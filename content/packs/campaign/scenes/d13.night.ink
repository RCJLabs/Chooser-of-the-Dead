# draft
// FIRST DRAFT (M7): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
EXTERNAL flag(name)
EXTERNAL home(id)
{ flag("ragna_waits") && not flag("ragna_hill") && home("mother"): -> hill }
-> muninn

// Ragna's chest, the last chance (docs/tech-spec.md §50): the hill at first light, or she won't see another.
=== hill ===
{
- home("brother") && not flag("ulf_shipyard"):
  The first raven of the night is from home, in Ulf's hand, and it's short.
  "Mother's worse. She coughed until the lamp went out, and after. The healer sat with her till dusk, and on her way out she said it plainly: the hill at first light, or she won't see another." # speaker: ulf
  "She says not to tell you. I'm telling you." # speaker: ulf
- else:
  The first raven of the night is from home, in a big slanting hand you don't know.
  "This is Bera, from next door. Your mother's worse. The healer sat with her till dusk, and on her way out she said it plainly: the hill at first light, or she won't see another." # speaker: bera
  "She says not to tell you. I'm telling you." # speaker: bera
}
* [Fly her up at dawn.]
  # fx: sun -180
  # fx: flag ragna_hill = 2
  You write one line, and send the raven back with it before it has had its supper: "Have her at the door."
* [You can't. Not now.]
  # fx: flag ragna_refused
  # fx: family mother gone
  You write that you can't. It takes three tries before it looks like your hand. You don't send it for a long while, and when the raven finally goes, it goes slowly.
- -> muninn

=== muninn ===
You are almost asleep when something taps on the shutter: three taps, a pause, then a fourth, as if it has lost count. # beat
It's Muninn. He hops in, settles on the end of your cot and looks at you for a long time.
"I remember you," he says. "I think." # speaker: muninn
"I remember the seeress. He woke her in her grave, you know, and made her sit up and tell him how it ends." # speaker: muninn
"The wolf. The ship. The fire. He knows all of it. He knows whose jaws. He's known since before you were born." # speaker: muninn
"And still he sends you out to choose. Every hero you stamp through is for a battle he knows he loses." # speaker: muninn
The raven shakes himself, and a feather comes loose and drifts down onto your blanket.
"I came to tell you something else. It was important. I've forgotten it." # speaker: muninn
// The jarl at the desk on Day 9 (docs/tech-spec.md §47): Memory keeps it when he's lost the rest.
{
- flag("jarl_bribe"):
  "I remember a jarl, though. Thirty rings on your table, and a stamp for Valhalla. Odd, what stays." # speaker: muninn
- flag("jarl_refused"):
  "I remember a jarl, though. He offered you thirty rings, and you sent him to Hel anyway. Odd, what stays." # speaker: muninn
}
// And the miser at the desk today (docs/tech-spec.md §59).
{
- flag("hrapp_draugr"):
  "And a miser, today. Forty rings, and you sent him home to his silver. The dead don't go home, you know. They come back wrong." # speaker: muninn
- flag("hrapp_refused"):
  "And a miser, today. Forty rings to be sent home, and you sent him to Hel. She'll have him counting her spoons." # speaker: muninn
}
* ["Try. What else did she tell him?"]
  # fx: flag truth +1
  Muninn closes his eyes. For so long that you think he's gone to sleep.
  "Green," he says at last. "She said something about green. After." # speaker: muninn
  "Ask the ones who keep the dead. They remember better than I do now." # speaker: muninn
  He hops back onto the sill. You're left holding the word like a warm stone.
* ["Then why does he keep going?"]
  # fx: standing odin +1
  "Because a host that loses well is better than a host that loses badly. That's what he says." # speaker: muninn
  "I don't remember whether he believes it." # speaker: muninn
  He hops back onto the sill and looks out at the dark.
* ["Does Skögul know?"]
  "Everyone at the gate knows. Nobody says it. That's what a gate is for." # speaker: muninn
  He hops back onto the sill and looks out at the dark.
- In the morning there's a black feather on your blanket, and you remember every word he said, which is more than he will.
-> END
