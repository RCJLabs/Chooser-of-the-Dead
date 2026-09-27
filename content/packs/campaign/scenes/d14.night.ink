# draft
// FIRST DRAFT (M7): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
EXTERNAL flag(name)
At dusk a young woman comes up the path from below, against the flow of the dead, walking the way people walk on ice.
She is very pale and very tidy, and her hair is braided so tight it looks painful. She stops at your table and waits to be noticed, which you have never seen anyone at the gate do.
"I'm Móðguðr. I keep the bridge to Hel's hall. The one roofed with gold, over the river." # speaker: modgudr
// If Ragna didn't climb the hill (docs/tech-spec.md §50).
{ flag("ragna_refused"):
  "Your mother crossed my bridge this morning. She asked the way to her father's bench, and whether anyone in the hall needed feeding." # speaker: modgudr
  "My lady is letting nobody in. She let her in." # speaker: modgudr
}
// Geir's widow at the desk today (docs/tech-spec.md §60), sent to her husband in Hel's hall.
{ flag("jofrid_with_geir") && flag("geir_hel"):
  "A widow crossed my bridge this afternoon, asking for Geir Hallsson. My lady is letting nobody in. She let her in." # speaker: modgudr
}
"The bridge rings when the dead cross it. It hasn't stopped ringing since the first winter. My lady would like it to stop for a while." # speaker: modgudr
"She isn't full. She's tired. The gods send her everyone who didn't die the way they like, and then they sing about the ones who did." # speaker: modgudr
"She'll open her doors again when someone at this gate says out loud that the quiet dead count." # speaker: modgudr
* ["Is my grandfather there?"]
  # fx: flag truth +1
  She thinks about it properly, which you hadn't expected.
  "An old man with a fever cough and a great many opinions about goats? He sits two benches down from Baldr. He talks to him about goats." # speaker: modgudr
  "Baldr doesn't mind. Baldr is waiting. When the fire is out, he walks out of our hall into the new world, and your grandfather means to walk out behind him." # speaker: modgudr
  You didn't know there was an after. She looks at you as if everyone knows.
* ["What do you want from me?"]
  "Say it. Mean it. My lady will know if you don't." # speaker: modgudr
- She waits.
* ["The quiet dead count."]
  # fx: standing hel +3
  # fx: standing odin -1
  # fx: flag sided_hel
  You say it out loud, at the gate, with the whole queue listening. Far below, very faintly, a bridge stops ringing, and then starts again.
  "Thank you." # speaker: modgudr
  She bows, a little stiffly, as if it's been a long time.
* ["Odin decides who counts."]
  # fx: standing odin +1
  # fx: standing hel -1
  "Then Odin can find somewhere to put them." # speaker: modgudr
  She goes back down the path, and doesn't look back, and doesn't hurry.
* [Say nothing.]
  She waits a little longer. Then she nods, as if you've told her something anyway, and goes.
- The clerk has been listening from his table. He writes something down and underlines it twice.
-> END
