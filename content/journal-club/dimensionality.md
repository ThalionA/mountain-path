---
title: Dimensionality
description: Why the activity of large neural populations often lives on a much lower-dimensional manifold than the number of neurons suggests — and what that does (or doesn't) tell us.
date: 2024-06-15
tags:
  - journal-club
  - neuroscience
  - population-coding
  - manifolds
---

The activity of a population of neurons occupies a certain state space, with any given state being defined as a certain level of activity for each neuron of the population. This state space has as many dimensions as the number of neurons in the population (for 2 neurons it's 2-dimensional, for 3 neurons 3-dimensional and so on).

Even though the number of neurons in any given area of the brain is very large, it is often found that the population activity occupies a lower-dimensional "manifold" (area of the total space) than the full dimensionality of the state space. For example, in 3D full space, it might just be constrained to a 2D plane.

It is currently debated whether this finding is simply a reflection of the non-ethological recording conditions (e.g. artificial stimuli like visual gratings that are nothing like the natural scenes that an animal would encounter in the environment it evolved in, or very simple tasks that require very simple [[Decision Making|decision making]] based on low information content), or whether there is a functional role of the reduced dimensionality of the activity (e.g. robustness to noise, separation of planning vs motor output).

When neurons of a population have variability that is independent to each other, then the dimensionality of the activity (the dimensions of the manifold on which the activity is constrained) will be relatively high. Conversely, if some neurons respond in a coordinated fashion, population activity will occupy only a smaller subset of the possible dimensions (since some of the dimensions will be redundant for the prediction of the full-dimensional activity).

Since we are usually dealing with high-dimensional population activity, some [[Dimensionality reduction|dimensionality reduction]] methods need to be employed in order to make sense of the neural responses. There are many techniques that have been developed, both linear (distances are preserved, e.g. PCA) and nonlinear (nonlinear scaling of distances, e.g. CEBRA). All of these techniques aim to capture most of the (relevant) variability of the full high-dimensional activity, and represent it in a lower-dimensional manner that is more amenable to inspection by human observers. There is always a trade-off between accuracy of the representation (how much of the original variability is captured) vs the reduction in dimensionality (and hence the interpretability of the representation). In the limit of high-accuracy, we just retain the initial uninterpretable high-dimensional representation, and at the opposite extreme, we drop everything onto 1 dimension, losing all the potentially relevant nuance in the activity.
