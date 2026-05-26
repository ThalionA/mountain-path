---
title: Hopfield network
description: A short concept page on Hopfield networks — architecture, energy function, Hebbian learning, and what sparsity buys you.
date: 2024-06-15
tags:
  - journal-club
  - neuroscience
  - networks
  - memory
---

## Overview

Hopfield Networks are a form of recurrent artificial neural network that serve as content-addressable ("associative") memory systems with binary threshold nodes. They were invented by John Hopfield in 1982. These networks store information in a way that mimics human memory: recall is based on a fragment of the original content.

## Key characteristics

- **Architecture**: Fully connected network with no self-loops.
- **Nodes**: Binary threshold units (can be in one of two states: −1 or 1).
- **Dynamics**: Asynchronous update rules. The asynchronous update rule ensures that the network will eventually converge to a stable state.

## Mathematical model

A Hopfield network can be described mathematically as follows:

- **Energy function**:
$$E = -\frac{1}{2} \sum_{i \neq j} w_{ij} s_i s_j$$
where $w_{ij}$ are the weights between units $i$ and $j$, and $s_i, s_j$ are the states of these units.

	- The network evolves towards a state of minimum energy, which corresponds to a stable pattern or memory.
	- The stable states (memories) are attractors in the energy landscape. Each attractor has a basin of attraction, and the initial state of the network determines which attractor it converges to.
	- The energy function acts as a [[Lyapunov function]], guaranteeing that the dynamics are stable and will converge to a local minimum.

- **Update rule**:
$$s_i^{new} = \text{sgn}\left(\sum_{j} w_{ij} s_j\right)$$
where $\text{sgn}$ is the sign function.

## Learning rule

The learning rule for a Hopfield network is Hebbian-like:

$$w_{ij} = \sum_{\mu} x_i^{\mu} x_j^{\mu}$$

for patterns $\mu$, where $x_i^{\mu}, x_j^{\mu}$ are the states of units in pattern $\mu$.

## What sparsity buys you

### 1. Increased storage capacity

- **Theoretical enhancement**: Sparse representations can significantly increase the storage capacity of a Hopfield network. The classical capacity of a standard Hopfield network is about $0.15N$ (where $N$ is the number of neurons). With sparsity, this capacity can be increased substantially.
- **Reduced overlap**: Sparse coding reduces the overlap between different stored patterns, which reduces interference and allows for more patterns to be stored effectively.

### 2. Improved recall quality

- **Pattern stability**: Sparsity can enhance the stability of stored patterns. Sparse patterns tend to be more distinct from each other compared to dense patterns, which reduces the likelihood of spurious states.
- **Noise robustness**: Sparse networks are generally more robust to noise. Since a significant portion of neurons are inactive, the network is less likely to confuse noise with an actual stored pattern.

### 3. Energy efficiency

- **Biological plausibility**: In biological neural networks, sparsity is a common feature, suggesting energy efficiency and computational advantages. Sparse Hopfield networks thus align more closely with biological neural network behaviour.
- **Reduced computational load**: Sparse activity reduces the computational load during both learning and recall phases, as fewer neurons are involved in computations.

### 4. Robustness to damage

- **Network damage**: Sparse networks can exhibit a higher degree of robustness to damage (e.g., loss of neurons or connections). Since fewer neurons are active, the loss of some neurons might not critically impair the network's functionality.

## Limitations

- Limited capacity (approximately $0.15N$ patterns for $N$ neurons). As the number of stored patterns approaches this limit, the quality of recall degrades due to interference between patterns.
- Susceptible to spurious states.
- Convergence to local, not global minima.

## Applications

- Pattern recognition
- Memory retrieval
- Optimisation problems
