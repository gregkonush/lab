import { db, Problem } from "astro:db"

// https://astro.build/db/seed
export default async function seed() {
  const problems = await db.insert(Problem).values([
    {
      description: `<p>You are given an integer <code>num</code>. You can swap two digits at most once to get the maximum valued number.</p>

<p>Return <em>the maximum valued number you can get</em>.</p>

<p>&nbsp;</p>
<p><strong class="example">Example 1:</strong></p>

<pre>
<strong>Input:</strong> num = 2736
<strong>Output:</strong> 7236
<strong>Explanation:</strong> Swap the number 2 and the number 7.
</pre>

<p><strong class="example">Example 2:</strong></p>

<pre>
<strong>Input:</strong> num = 9973
<strong>Output:</strong> 9973
<strong>Explanation:</strong> No swap.
</pre>

<p>&nbsp;</p>
<p><strong>Constraints:</strong></p>

<ul>
	<li><code>0 &lt;= num &lt;= 10<sup>8</sup></code></li>
</ul>
`,
      title: "670. Maximum Swap",
      topics: ["Math", "Greedy"],
      url: "https://leetcode.com/problems/maximum-swap/description",
      difficulty: "medium",
    },
  ])
}
