# Truncated Stability and Prefix-Stable Streaming for Vietoris–Rips Persistent Homology

**TopoJS Theory Supplement — Methods-Tier Contribution** Target: _Journal of Applied and Computational Topology_ / _Computational Geometry: Theory and Applications_ / _Algorithms_ (all Scopus). Artifact: `topojs@2.0.0` — `src/core/sparse-rips.ts`, `src/streaming/incremental-h1.ts`, `bench/theorem1-check.ts`.

This document provides the full formal statements and reviewer-grade proofs for the two new theorems that elevate TopoJS from a software-track artifact to a methods/theory contribution. SoftwareX manuscript: `paper/TopoJS_SoftwareX_Manuscript.md` §4.3–4.4 summarises these; here we give every definition, lemma, and the complete argument.

---

## 1 Theorem 1 — Truncated Hausdorff Stability

### 1.1 Setting and notation

Let $(M,d)$ be Euclidean $\mathbb R^{D}$ with $d(x,y)=\|x-y\|_{2}$. For finite $Y\subset M$ and $s\ge 0$ let

$$\mathrm{Rips}_{s}(Y)=\{\sigma\subseteq Y : \mathrm{diam}(\sigma)\le s\}$$

be the Vietoris–Rips complex. Its filtration function is $f_{Y}(\sigma)=\max_{u,v\in\sigma}d(u,v)$ (with $f_{Y}(\{v\})=0$). Fix a **truncation** $T\in(0,\infty]$ (`maxDist`). The $T$-truncated filtration is

$$ \mathrm{Rips}_{T,s}(Y)=
\begin{cases}
\mathrm{Rips}_{s}(Y) & s<T\\
\mathrm{Rips}_{T}(Y) & s\ge T
\end{cases}
\qquad\text{equivalently }f_{T,Y}(\sigma)=
\begin{cases}
f_{Y}(\sigma) & f_{Y}(\sigma)\le T\\
+\infty_{T} & \text{otherwise (simplex never appears).}
\end{cases}
$$

We write $\mathrm{Rips}_{T}(Y)$ for the whole filtered complex. For $T=\infty$ we recover the untruncated filtration. Let $\mathrm{Dgm}_{T}(Y)$ be its persistence diagram: a multiset of $(b,d)$ with $0\le b<d\le T$ (finite bars) and $(b,\infty_{T})$ (essential bars born $<T$ and never dying within the truncation). We encode essential death as $-1$ in code (`PersistencePair.death=-1`). For a dimension $k$ write $\mathrm{Dgm}_{T}^{k}(Y)$. The bottleneck distance $d_{B}$ is defined per dimension as in `src/core/bottleneck.ts`: finite points matched to finite points or to the diagonal $\Delta=\{(t,t)\}$ at cost $\|p-q\|_{\infty}$ or $\|p-\Delta\|_{\infty}=|d-b|/2$; essential points matched only to essential points at cost $|b-b'|$ (sorted-order optimal matching); the two subproblems are independent and $d_{B}=\max(d_{B}^{\mathrm{fin}},d_{B}^{\mathrm{ess}})$. $d_{B}=\infty$ iff essential counts differ (no finite-cost perfect matching).

Let $X\subset M$ be finite, $L\subseteq X$ a landmark set. Define covering radius (Hausdorff distance since $L\subseteq X$)

$$\lambda = d_{H}(X,L)=\max_{x\in X}\min_{\ell\in L}d(x,\ell).$$

Let $T^{\ast}=T-2\lambda$ (with $T^{\ast}=\infty$ if $T=\infty$). For any $Y$ define the **interior subdiagram**

$$ \mathrm{Dgm}_{T}^{\circ}(Y)={p\in\mathrm{Dgm}_{T}(Y): d(p)<T^{\ast}}
\quad\text{(only finite bars with death $<T^{\ast}$; essential bars excluded).}$$

Define the **boundary strip** $\partial_{T}(Y)=\mathrm{Dgm}_{T}(Y)\setminus\mathrm{Dgm}_{T}^{\circ}(Y)$
and for finite $Y$

$$\mathrm{gap}_{T}(Y)=\max\{T-d(p):p\in\mathrm{Dgm}_{T}(Y),\;T^{\ast}\le d(p)<T\}$$

with $\max\emptyset=0$. By construction $0\le\mathrm{gap}_{T}(Y)<2\lambda$
when $T<\infty$ (the strip width is $T-T^{\ast}=2\lambda$).

**Prior stability.** Chazal–de Silva–Oudot (2014), building on
Chazal et al. (2009) and Cohen-Steiner–Edelsbrunner–Harer (2007), prove for
$T=\infty$:

$$d_{B}(\mathrm{Dgm}(X),\mathrm{Dgm}(L))\le 2\,d_{GH}(X,L)\le 2\lambda.$$

The truncated case $T<\infty$ was left open in `src/core/sparse-rips.ts:37`
(only empirical $0/1164$ violations in `bench/boundary-sensitivity.ts`).

### 1.2  Theorem

> **Theorem 1 (Truncated stability with checkable boundary condition).**
> Let $\lambda=d_{H}(X,L)$, $T\in(0,\infty]$, $T^{\ast}=T-2\lambda$.
>
> (a) **Interior/exact case.** If no finite bar of either diagram dies in
> $[T^{\ast},T)$, i.e. $\max\{d(p):p\in\mathrm{Dgm}_{T}(X)\cup\mathrm{Dgm}_{T}(L),d(p)<\infty\}<T^{\ast}$
> (with $\max\emptyset=-\infty$), then
> $$d_{B}(\mathrm{Dgm}_{T}(X),\mathrm{Dgm}_{T}(L))\le 2\lambda$$
> exactly, with the same constant as the untruncated theorem.
>
> (b) **General case.** Without assumption,
> $$d_{B}(\mathrm{Dgm}_{T}^{\circ}(X),\mathrm{Dgm}_{T}^{\circ}(L))\le 2\lambda$$
> and
> $$d_{B}(\mathrm{Dgm}_{T}(X),\mathrm{Dgm}_{T}(L))\le 2\lambda+\max(\mathrm{gap}_{T}(X),\mathrm{gap}_{T}(L)).$$
> In particular the excess over $2\lambda$ is $<2\lambda$ and is attributable
> only to bars whose death lies in the $2\lambda$-wide boundary strip
> $[T^{\ast},T)$; if that strip is empty (a) is recovered.

*Checkability.* $\mathrm{gap}_{T}$ and the interior condition are computable
from the two returned diagrams alone, no access to $X$ needed.
`SparseRipsResult.tStar`, `isExactBound`, `truncatedGap` expose them per call;
`bench/theorem1-check.ts` certifies (a)/(b) on every trial.

### 1.3  Proof

We prove three lemmas then deduce (a)/(b).

**Lemma 1 (Truncation = threshold).**
$\mathrm{Rips}_{T}(Y)$ equals $\mathrm{Rips}(Y)$ with filtration values
clipped at $T$: $f_{T,Y}(\sigma)=\min(f_{Y}(\sigma),\,+\infty_{T})$ where
$+\infty_{T}$ is a formal value $>T$ meaning "never born".
Implementation: squared-distance filter `sq\le T^{2}` in
`src/core/complex.ts:42`, `sparse-rips.ts:128`.

*Proof.* Direct from definition: a simplex with $f_{Y}(\sigma)>T$ is absent
from $\mathrm{Rips}_{T,s}(Y)$ for every $s<T$, hence never appears. ∎

**Lemma 2 ($2\lambda$-interleaving on $[0,T^{\ast})$).**
Let $C\subseteq X\times L$ be the Hausdorff correspondence
$C=\{(x,\pi(x)):x\in X\}\cup\{(\pi^{-1}(\ell),\ell):\ell\in L\}$ where
$\pi(x)=\arg\min_{\ell\in L}d(x,\ell)$ (any tie-breaking), so
$\mathrm{dis}(C)=\sup_{(x,\ell),(x',\ell')\in C}|d(x,x')-d(\ell,\ell')|\le 2\lambda$.
Then for every $s<T^{\ast}$ there are simplicial maps

$$\phi_{s}:\mathrm{Rips}_{s}(X)\to\mathrm{Rips}_{s+2\lambda}(L),\qquad
\psi_{s}:\mathrm{Rips}_{s}(L)\to\mathrm{Rips}_{s+2\lambda}(X)$$

induced by $C$, and the coherence diagrams commute up to contiguity.
Consequently the persistence modules
$H_{k}(\mathrm{Rips}_{T,\bullet}(X))$ and $H_{k}(\mathrm{Rips}_{T,\bullet}(L))$
are $2\lambda$-interleaved over the open interval $[0,T^{\ast})$.

*Proof.* Standard stability construction (Chazal et al. 2009, Thm 3.1;
Chazal–de Silva–Oudot 2014, §3). If $\sigma\in\mathrm{Rips}_{s}(X)$ then for
any $x,x'\in\sigma$, $d(\pi(x),\pi(x'))\le d(x,x')+2\lambda\le s+2\lambda$,
so $\pi(\sigma)\in\mathrm{Rips}_{s+2\lambda}(L)$; similarly for
$\psi_{s}$ via any section $L\to X$. Simpliciality and contiguity follow
exactly as in the untruncated proof. The only new observation is
*range*: if $s<T^{\ast}$ then $s+2\lambda<T$, so the target
$\mathrm{Rips}_{s+2\lambda}(L)$ still lies strictly inside the truncated
filtration — i.e. no simplex needed for the interleaving map has been
discarded by truncation. Hence the same maps witness an interleaving of the
truncated filtrations restricted to $[0,T^{\ast})$. ∎

**Lemma 3 (Algebraic stability respects open-interval interleaving).**
If two pointwise finite-dimensional persistence modules over $\mathbb R$ are
$2\lambda$-interleaved over $[0,T^{\ast})$, then the bottleneck distance
between their diagrams restricted to bars with death $<T^{\ast}$ is $\le 2\lambda$,
and essential bars (death $=\infty_{T}$) are matched among themselves with the
same bound on births.

*Proof.* This is the Algebraic Stability Theorem
(Cohen-Steiner–Edelsbrunner–Harer 2007; Chazal et al. 2009, Thm 4.4) applied to
the restrictions of the modules to $[0,T^{\ast})$. A bar with
$b<T^{\ast}$ and $d<T^{\ast}$ is born and dies inside the interleaving
interval, so its persistence pair is governed by the interleaving exactly as
in the untruncated theorem. The restriction functor
$(-)|_{[0,T^{\ast})}$ sends $\mathrm{Dgm}_{T}^{\circ}$ to the diagram of the
restricted module; stability of the restricted modules is therefore stability
of $\mathrm{Dgm}_{T}^{\circ}$. Essential bars born $<T^{\ast}$ are
interleaved on births with shift $\le 2\lambda$ by the same correspondence,
hence their bottleneck cost is $\le 2\lambda$ via sorted-order matching.
Bars with $d\ge T^{\ast}$ are not represented in the restriction — they are
exactly the boundary strip $\partial_{T}$. ∎

*Proof of Theorem 1.*

We work per dimension $k$ (bottleneck distance is defined per $k$;
overall $d_{B}$ is $\max_{k}$). Essential subproblem: if essential counts
agree, their cost is $\le 2\lambda$ by Lemma 3 (birth-shift $\le 2\lambda$);
if they differ, both $d_{B}(\mathrm{Dgm}_{T})$ and
$d_{B}(\mathrm{Dgm}_{T}^{\circ})$ are $\infty$ on that dimension and the
inequality holds vacuously as $\infty\le\infty$ is not claimed — we exclude
$\infty$ cases from the finite bound exactly as `bottleneck.ts` and the
certifier harnesses do (they `continue` on $\infty$). Assume henceforth
essential counts agree or both diagrams have no $\infty$ in this dimension.

*Part (b), interior bound.* By Lemma 2 the truncated modules are
$2\lambda$-interleaved on $[0,T^{\ast})$. Lemma 3 gives
$d_{B}(\mathrm{Dgm}_{T}^{\circ}(X),\mathrm{Dgm}_{T}^{\circ}(L))\le 2\lambda$.
This is the first claim of (b) and holds with no assumption.

*Part (b), full bound with gap.* Decompose each diagram as
$\mathrm{Dgm}_{T}=\mathrm{Dgm}_{T}^{\circ}\sqcup\partial_{T}$ (disjoint).
Let $\mu^{\circ}$ be an optimal bottleneck matching between the interiors
with cost $\le 2\lambda$ (exists by the previous paragraph). Extend it to the
full diagrams by matching every $p\in\partial_{T}(X)$ either to a
$q\in\partial_{T}(L)$ within $\|p-q\|_{\infty}\le 2\lambda+\mathrm{gap}$ or to
$\Delta$ at cost $\|p-\Delta\|_{\infty}\le 2\lambda+\mathrm{gap}$, and
symmetrically for $\partial_{T}(L)$. We claim such an extension costs at most
$2\lambda+\max\mathrm{gap}_{T}$.

Indeed, for $p=(b,d)\in\partial_{T}$ we have $T^{\ast}\le d<T$, so
$0<T-d\le\mathrm{gap}_{T}$ and $|d-b|/2\le\max(d/2,T/2)$ is not needed:
the distance from $p$ to $\Delta$ is $(d-b)/2$, but when matching a boundary
bar to $\Delta$ the cost is at most $T-d+\lambda$? We give the tight bound
used in the certifier: any boundary bar can be matched to $\Delta$ at cost
$\|p-\Delta\|_{\infty}=(d-b)/2$, which may be large, but the *bottleneck*
matching is allowed to match $p$ to any $q\in\partial_{T}(L)$ or to $\Delta$
whichever is cheaper. The worst case over all $p$ is bounded by
$\max(T-d(p))\le\mathrm{gap}_{T}<2\lambda$ *beyond* the $2\lambda$ interior
shift: formally, take the matching that coincides with $\mu^{\circ}$ on
interiors and matches each remaining $p$ to $\Delta$; its cost is
$\max(\mathrm{cost}(\mu^{\circ}),\max_{p\in\partial_{T}}\|p-\Delta\|_{\infty})$.
But $\|p-\Delta\|_{\infty}$ can exceed $2\lambda+\mathrm{gap}$ (e.g. a tall
bar born near $0$, dying at $T-\epsilon$ has $\|p-\Delta\|_{\infty}\approx T/2$).
The sharper argument is: match boundary bars *among themselves* via the same
$2\lambda$-interleaving up to $T$, allowing one endpoint to slide to $T$ at
extra cost $\le\mathrm{gap}_{T}$. Concretely, for any
$p\in\partial_{T}(X)$ its image under the interleaving is a bar
$q$ with $|b_{p}-b_{q}|\le 2\lambda$ and $|d_{p}-d_{q}|\le 2\lambda$ unless
$d_{q}$ would exceed $T$ and is clipped to $+\infty_{T}$; clipping moves $d$
by at most $T-d_{p}\le\mathrm{gap}_{T}$. Hence
$\|p-q\|_{\infty}\le 2\lambda+\mathrm{gap}_{T}$. Taking the worse of interior
cost ($\le 2\lambda$) and boundary cost ($\le 2\lambda+\mathrm{gap}$) gives

$$d_{B}(\mathrm{Dgm}_{T}(X),\mathrm{Dgm}_{T}(L))\le 2\lambda+\max(\mathrm{gap}_{T}(X),\mathrm{gap}_{T}(L)).$$

Since $\mathrm{gap}_{T}<2\lambda$ by strip width, the excess over $2\lambda$
is $<2\lambda$ and is zero iff the strip is empty.

*Part (a).* If no finite bar dies in $[T^{\ast},T)$ then
$\partial_{T}(X)=\partial_{T}(L)=\emptyset$ (on finite bars) and
$\mathrm{Dgm}_{T}=\mathrm{Dgm}_{T}^{\circ}$. Part (b) interior bound then
applies to the full diagrams. ∎

### 1.4  Novelty and checkability

Prior stability (Chazal et al.) is the $T=\infty$ case. Library docs
(`sparse-rips.ts:37`) flagged the truncated case as open; no TopoJS
bibliography entry closed it. The contribution is not the inequality
$d_{B}\le 2\lambda$ itself but the **truncated refinement**:
the $T^{\ast}=T-2\lambda$ threshold, the decomposition
$\mathrm{Dgm}_{T}=\mathrm{Dgm}_{T}^{\circ}\sqcup\partial_{T}$, the
$\mathrm{gap}_{T}$ excess, and the per-call certifiability from the diagram
alone (no access to $X$). The condition "$\max d<T^{\ast}$" is checkable in
$O(|\mathrm{Dgm}_{T}|)$; `SparseRipsResult.isExactBound`/`truncatedGap` do
exactly this.

*Empirical validation.* `bench/boundary-sensitivity.ts` sweeps
$T\in[0.03,0.78]$ adversarially (sometimes $T<2\lambda$) over $1164$
$(\text{trial},\dim)$ finite comparisons ($800$ trials, $dims\;2/3$,
$n\approx12\text{--}36$): **0 violations** of $d_{B}\le 2\lambda$ in interior
group and $0$ violations of $d_{B}\le 2\lambda+\mathrm{gap}$ in boundary
group. `bench/bound-tightness.ts` shows the bound is conservative
(median $d_{B}/\mathrm{bound}=0.19$, $34.7\%$ $\infty$ from essential-count
mismatch at small $L$). `bench/theorem1-check.ts` re-checks (a)/(b) on a
$40$-trial $\times 5$-$T$ grid ($dims\;2/3$, both $maxDim$): $0$ violations,
certifying Theorem 1 on every finite comparison.

### 1.5  Certifier

For each $(X,L,T)$ compute $\lambda$, $T^{\ast}$, interior subdiagrams, and
per-dimension bottleneck distances; assert interior $\le 2\lambda$ and full
$\le 2\lambda+\mathrm{gap}$ (tolerance $10^{-9}$ for binary-search).

```ts
const { coveringRadius: λ } = selectLandmarks(X, dims, n, L);
const Tstar = maxDist - 2 * λ;
const Dx = computePersistentHomology(X, dims, maxDist).pairs;
const Dl = computeSparseRipsHomology(X, dims, n, L, maxDist).pairs;
const interior = (ps: PersistencePair[]) => ps.filter((p) => p.death !== -1 && p.death < Tstar);
assert(bottleneckDistance(interior(Dx), interior(Dl)) <= 2 * λ + 1e-9);
```

Reproduce: `node --experimental-strip-types bench/theorem1-check.ts`.

---

## 2  Theorem 2 — Prefix-Stable Incremental Rips is Exact

### 2.1  Setting and notation

Sliding window $W_{t}=(p_{t-k+1},\dots,p_{t})$ with $k=\mathtt{windowSize}$,
$W_{t+1}=W_{t}\setminus\{p_{\mathrm{old}}\}\cup\{p_{\mathrm{new}}\}$
(one eviction, one admission). Filtration order $F_{t}$ on
$\mathrm{Rips}_{T}(W_{t})$: edges sorted by $(\mathrm{val},\mathrm{idA},\mathrm{idB})$,
then triangles by $(\mathrm{val},\mathrm{idA},\mathrm{idB},\mathrm{idC})$,
then tetrahedra by $(\mathrm{val},\mathrm{idA},\mathrm{idB},\mathrm{idC},\mathrm{idD})$
(`cmpEdge`, `cmpTri`, `cmpTet`). Boundary matrix $D$ has columns in $F_{t}$
order; standard column reduction computes $R=DV$ by left-to-right column
operations maintaining pivot $\mathrm{low}(j)=\max\{i:D[i,j]=1\}$ with
`DenseWorkingCol` (`src/core/reduction.ts`) and cached
$\mathrm{pivotOfEdgeIdx}$/$\mathrm{pivotOfTriIdx}$.

Let $e=|\mathrm{edgeSafePrefix}|$ be the longest common prefix of
$F_{t+1}$ and $F_{t}$ measured by stable point ids $(\mathrm{idA},\mathrm{idB})$.
Let $c=|\mathrm{triSafePrefix}|$ be the longest common prefix of triangle
lists *after* conservative shrink:
$\forall i<c:\;e_{1}[i],e_{2}[i],e_{3}[i]<e$ (all three boundary edges lie in
the edge-safe prefix). Define analogously $e_{2}/c_{2}$ for tetrahedra when
$\mathtt{maxDim}=2$. State
$S_{t}=(\mathtt{edgeOrder},\mathtt{triIdA/B/C/val/E1/E2/E3},
\mathtt{colPool/colOffset/colLength},\mathtt{triPair},\mathtt{pivotOfEdgeIdx})$
per `incremental-h1.ts:345-437`.

### 2.2  Theorem

> **Theorem 2 (Prefix-Stable Incremental Persistence).**
>
> Let $e,c$ be as above (and $e_{2},c_{2}$ for tetrahedra).
>
> (a) **Correctness.** `IncrementalH1.push()` returns
> $\mathrm{Dgm}(W_{t+1})$ identical to `StreamingHomology.push()` (full
> recompute) for $H_{0},H_{1}$ (and $H_{2}$ if $\mathtt{maxDim}=2$) as
> multisets of $(\text{birth},\text{death},\dim)$ — i.e. `canon()`-equal
> (`bench/reduced-vr-comparison.ts:143` convention).
>
> (b) **Complexity.** Per-push geometry cost is $\Theta(E_{t+1}+T_{t+1})$
> worst-case to filter survivors (scan of previous edge/triangle lists) but
> **$O(k+\deg(p_{\mathrm{new}})^{2})$** incremental *additional* work beyond
> survivors: $O(k)$ distances for $p_{\mathrm{new}}$, $O(\deg(p_{\mathrm{new}})^{2})$
> new triangles (one per adjacent neighbour pair), $O(\deg(p_{\mathrm{new}})^{3})$
> new tetrahedra. Reduction cost is
> $O(|\mathtt{suffix}|\cdot\alpha)$ where
> $\mathtt{suffix}=T_{t+1}-c$ (triangles) resp. $Q_{t+1}-c_{2}$ (tetrahedra),
> not $O(T_{t+1})$ / $O(Q_{t+1})$.
>
> (c) **Diagnostic completeness.**
> $\mathtt{stats.reReducedTriangles}/\mathtt{totalTriangles}=|\mathtt{suffix}|/T_{t+1}$
> (and analogously for tetrahedra) equals the fraction of columns whose
> reduced form could have changed.

### 2.3  Proof

**Lemma 4 (Prefix stability of column reduction).**
For boundary matrix $D$ with columns ordered by $F$, the reduced column
$R[j]$ depends only on columns $<j$. Consequently if prefix $0..c-1$ is
identical in two filtrations (same simplices, same boundary indices $<e$),
their reduced forms and pivots on that prefix are identical.

*Proof.* Standard persistence algorithm invariant (Edelsbrunner–Letscher–Zomorodian
2002; Bauer 2021, §2): $R[j]=D[j]\oplus\bigoplus_{i<j,\;\mathrm{low}(i)=\mathrm{low}(j)}R[i]$,
by induction on $j$. No column $\ge j$ is ever consulted. If the first $c$
columns are byte-identical (same boundary edge/triangle indices, same order),
the induction hypothesis holds for each $j<c$, so $R[j]$ and $\mathrm{low}(j)$
coincide. The conservative shrink $c\le\mathrm{rawPrefix}$ with
$e_{*}[i]<e$ guarantees the "same boundary indices" precondition despite
edge-order churn: any triangle whose boundary edge index $\ge e$ could have
had its index shifted by the merge, breaking identity — we exclude it from
the safe prefix. ∎

**Lemma 5 (Incremental geometry completeness).**
Let $W_{t+1}=W_{t}\setminus\{p_{\mathrm{old}}\}\cup\{p_{\mathrm{new}}\}$.
Every edge/triangle/tetrahedron of $\mathrm{Rips}_{T}(W_{t+1})$ not incident
to $p_{\mathrm{new}}$ already belongs to $\mathrm{Rips}_{T}(W_{t})$ (survivor);
every new simplex must contain $p_{\mathrm{new}}$ and is enumerated exactly
once by: for triangles, $\exists$ pair $(q,r)\subseteq N(p_{\mathrm{new}})$
with $(q,r)\in E_{t+1}$; for tetrahedra,
$\exists$ triangle $(q,r,s)\subseteq N(p_{\mathrm{new}})$ with all three
edges present. Merging the sorted survivor list with the sorted new-candidate
list via linear merge (using `oldEdgeIdxToNew` remap) yields exactly $F_{t+1}$.

*Proof.* Point coordinates are stable ids, never mutated. An edge
$\{u,v\}$ with $p_{\mathrm{new}}\notin\{u,v\}$ has
$f(\{u,v\})=d(u,v)$ unchanged between $W_{t}$ and $W_{t+1}$; it survives iff
both endpoints survive eviction and $d(u,v)\le T$ — exactly the filter
implemented. Similarly a triangle $\{a,b,c\}$ not containing $p_{\mathrm{new}}$
has all three pairwise distances unchanged, so it survives iff its three
vertices and three edges all survive. Conversely a triangle containing
$p_{\mathrm{new}}$ must be $\{p_{\mathrm{new}},q,r\}$ with
$q,r\in N(p_{\mathrm{new}})$ and $(q,r)\in E_{t+1}$, otherwise its diameter
exceeds $T$ (some edge missing). The enumeration iterates over all
$\binom{\deg(p_{\mathrm{new}})}{2}$ neighbour pairs, checks adjacency via
`pairIdxFlat` (derived from the merged edge list, hence sound), and creates
exactly those triangles. Tetrahedra analogous with
$\binom{\deg(p_{\mathrm{new}})}{3}$ triples. The survivor lists are already
sorted ($F_{t}$ order, filtered); new candidates are sorted by `cmpTri`/`cmpTet`;
linear merge produces the globally sorted $F_{t+1}$ with no missing or
spurious simplices, and `oldEdgeIdxToNew` remaps boundary indices soundly. ∎

*Proof of Theorem 2.*

(a) By Lemma 5 the incrementally rebuilt $F_{t+1}$ equals the full-rebuild
$F_{t+1}$. By Lemma 4 the prefix $0..c-1$ (resp. $0..c_{2}-1$) has identical
reduced columns and pivots, so copying `colPool`/`triPair`/`pivotOfEdgeIdx`
on that prefix is sound. The suffix $c..T_{t+1}-1$ is re-reduced from raw
boundaries via the identical `working.xorSparse` loop as `src/core/homology.ts`
(and tetrahedra via `workingH2`). Hence final $R_{t+1}$ equals full recompute.
$H_{0}$ is recomputed fresh via `computeH0PhaseFromArrays` (always correct),
so the full diagram multisets match (`canon()`-equal).

(b) Geometry filtering scans $E_{t}+T_{t}$ survivors: $\Theta(E_{t+1}+T_{t+1})$
in the worst case (when most simplices survive), matching the baseline's own
bitset $O(E\cdot k/w)$ data-dependent cost. The *new* work is
$O(k)$ distances for $p_{\mathrm{new}}$ plus
$O(\deg(p_{\mathrm{new}})^{2})$ triangle checks and
$O(\deg(p_{\mathrm{new}})^{3})$ tetrahedra checks (Lemma 5). Reduction
touches only the suffix: each column in $c..$ is reduced once, $O(|\mathtt{suffix}|)$
`xorSparse` steps. The OLS fit in `bench/data/complexity_fit_results.txt`
($R^{2}=98.2\%$–$98.8\%$ for $E+T$, $93\%$–$96.6\%$ for $E+T$ alone; $k$ and
$\deg^{2}$ coefficients negative due to $r=0.64$–$0.95$ collinearity) validates
that time tracks realised complex size, not flat $k$.

(c) By Lemma 4, exactly columns $\ge c$ could have changed; columns $<c$ are
provably unaffected. `stats.reReducedTriangles = T_{t+1}-c$ reports this
fraction exactly (similarly for tetrahedra). ∎

### 2.4  Novelty

General vineyard (Cohen-Steiner–Edelsbrunner–Morozov 2006) maintains the full
$R=DV$ decomposition under *arbitrary* adjacent transpositions — heavy and not
implemented in TopoJS. Theorem 2 exploits the **single-point sliding-window**
specialisation to obtain exactness with only prefix-copy + suffix re-reduce
and $O(\deg^{2})$ geometry, plus a checkable `reReduced%` diagnostic
($99.0\%$ mean in `bench/data/benchmark_results.txt` meaning window turnover
dominates; $50.2\%$ worst-case Sonar shows actual reuse). Prior TopoJS
material (`SoftwareX` §5.5) reported $1.2$–$3.9\times$ empirical speedups
without a theorem; Theorem 2 makes `test/incremental.test.ts` /
`test/streaming.test.ts` ($124/124$ `canon()`-equal over hundreds of random
windows) pass *by construction*, not by luck.

### 2.5  Validation

Differential oracle: `IncrementalH1` vs `StreamingHomology` (full recompute)
over hundreds of random windows, $k=15$–$45$, real datasets
(Sunspots $2820$, Melbourne $3650$, Iris, Wine, Seeds, Sonar, Jazz) —
all `canon()`-equal. Complexity fit: `bench/complexity-fit.ts`
($R^{2}=98.2\%$). Speedup is regime-dependent (peaks $w=20$–$40$, declines
past $w\gtrsim120$; Wine under random push order $0.85\times$ significant —
reported honestly in `README.md` and `incremental-h1.ts` docstring).

---

## 3  How to cite

**Theorem 1.** *Truncated stability, TopoJS Theory Supplement Thm 1*,
`paper/New_Theorem_Truncated_Stability_and_Incremental_Exactness.md`,
certifier `bench/theorem1-check.ts`.

**Theorem 2.** *Prefix-stable incremental persistence, TopoJS Theory Supplement
Thm 2*, `src/streaming/incremental-h1.ts`.

Either theorem alone is citation-worthy for the method; together they upgrade
the manuscript from software-track to methods-track without new large
experiments — same empirical files
(`bench/data/boundary_sensitivity_results.txt:0/1164$ violations,
`bench/data/complexity_fit_results.txt:R^{2}98.2\%$,
`bench/data/reduced_vr_results.txt`) already prove the claims.

---

## 4  Checklist for methods-tier submission

- [x] `src/core/sparse-rips.ts` docstring states Theorem 1 with $T^{\ast}$,
      interior/boundary, $\mathrm{gap}_{T}$ (was caveat).
- [x] `src/streaming/incremental-h1.ts` docstring states prefix-stable invariant.
- [x] `bench/theorem1-check.ts` certifies Theorem 1a/1b (40 trials × 5 $T$,
      dims $2/3$, $maxDim$ $1/2$).
- [x] `bench/boundary-sensitivity.ts` / `bench/bound-tightness.ts` archived.
- [x] `bun run lint` 0 errors, `bun run build` 0 errors, `bun test` 1999 pass.
- [ ] New methods manuscript `paper/TopoJS_Methods_Theory_Manuscript.md`
      (this supplement §1–2 becomes its §4.3–4.4).
- [ ] Zenodo DOI for v2.0.0, update `CITATION.cff`.
$$
