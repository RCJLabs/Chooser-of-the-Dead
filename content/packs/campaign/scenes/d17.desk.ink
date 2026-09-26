# draft
// FIRST DRAFT (docs/tech-spec.md §59): rewrite or sign off. Hel at the desk on Day 17, the day of the spear-mark
// loophole: a death in bed counts as Odin's if a spear marked the dying first, as he marked himself. Móðguðr spoke for
// her on Day 14; this time she comes herself. The sun holds while she's there.
EXTERNAL flag(name)
The next in line isn't dead, or isn't only dead. Half her face is a young woman's, and the other half is the colour of a week-old bruise, and she holds both halves perfectly still.
The queue goes quiet all the way down the path. Skögul puts her bread away.
"I came to see the new rule work," says Hel. "The spear." # speaker: hel
"A man dies in his bed, of a cough, of being old, and someone scratches him with a spear on the way out, and he's Odin's. Odin did it to himself first. He likes to be first." # speaker: hel
{ flag("sided_hel"):
  "You said the quiet dead count. Móðguðr told me. I opened the doors that night. I wanted to see who'd said it." # speaker: hel
}
* ["It's the rule. I stamp by the rules."]
  # fx: standing odin +1
  # fx: standing hel -1
  "Yes," she says. "That's what a gate is for." She doesn't sound angry. She sounds like someone who expected nothing, and got it. # speaker: hel
* ["It's a cheat, and he knows it."]
  # fx: standing hel +1
  # fx: standing odin -1
  The dead half of her mouth moves, which might be a smile.
  "Don't say it too loud. He has two ravens, and nothing for them to do all day but listen." # speaker: hel
* [Say nothing.]
  She waits. Then she nods, the way Móðguðr did, as if you'd told her something anyway.
- She looks down the line once more, counting something, and goes back down the path. The queue lets its breath out.
-> END
