"""
OceanEmbedNet — exact architecture extracted from:
    NoteBooks/Final5YearModel.ipynb

Architecture:
    CNN encoder (3 conv layers)
    → per-timestep spatial features [B, T, 64, H, W]

    GRU (position-wise, applied across T)
    → temporal features, last hidden state [B, 64, H, W]

    Channel attention (AdaptiveAvgPool2d + Linear squeeze-excite)
    → attention-weighted features [B, 64, H, W]

    CNN decoder (2 conv + 1×1 head)
    → output [B, 14, H, W]

Input:  [B, T, 14, H, W]   T=SEQUENCE_LENGTH, 14 channels
Output: [B, 14, H, W]      14 normalised depth predictions
"""

import torch
import torch.nn as nn


class OceanEmbedNet(nn.Module):

    def __init__(
        self,
        in_channels: int = 14,
        embedding_dim: int = 64,
        out_channels: int = 14,
    ):
        super().__init__()

        # ------------------------------------------------------------------ #
        # CNN ENCODER
        # ------------------------------------------------------------------ #
        self.encoder = nn.Sequential(
            nn.Conv2d(in_channels, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),

            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),

            nn.Conv2d(64, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
        )

        # ------------------------------------------------------------------ #
        # TEMPORAL GRU  (position-wise: each spatial cell is a sequence)
        # ------------------------------------------------------------------ #
        self.gru = nn.GRU(
            input_size=64,
            hidden_size=64,
            num_layers=1,
            batch_first=True,
        )

        # ------------------------------------------------------------------ #
        # CHANNEL ATTENTION  (squeeze-excite)
        # ------------------------------------------------------------------ #
        self.attention_pool = nn.AdaptiveAvgPool2d(1)

        self.attention = nn.Sequential(
            nn.Linear(64, 16),
            nn.ReLU(inplace=True),
            nn.Linear(16, 64),
            nn.Sigmoid(),
        )

        # ------------------------------------------------------------------ #
        # CNN DECODER
        # ------------------------------------------------------------------ #
        self.decoder = nn.Sequential(
            nn.Conv2d(64, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),

            nn.Conv2d(64, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),

            nn.Conv2d(32, out_channels, kernel_size=1),
        )

    # ---------------------------------------------------------------------- #

    def forward(self, x: torch.Tensor, return_embedding: bool = False):
        """
        x : [B, T, C, H, W]
        returns : [B, out_channels, H, W]
        """
        B, T, C, H, W = x.shape

        # ── spatial encoding ──────────────────────────────────────────────
        encoded = []
        for t in range(T):
            z = self.encoder(x[:, t])   # [B, 64, H, W]
            encoded.append(z)

        encoded = torch.stack(encoded, dim=1)   # [B, T, 64, H, W]

        # ── temporal GRU (position-wise) ──────────────────────────────────
        # reshape so every spatial position is an independent batch element
        gru_input = encoded.permute(0, 3, 4, 1, 2)        # [B, H, W, T, 64]
        gru_input = gru_input.reshape(B * H * W, T, 64)   # [B*H*W, T, 64]

        gru_output, _ = self.gru(gru_input)                # [B*H*W, T, 64]
        z = gru_output[:, -1]                              # last step → [B*H*W, 64]

        z = z.reshape(B, H, W, 64).permute(0, 3, 1, 2)   # [B, 64, H, W]

        # ── channel attention ─────────────────────────────────────────────
        pooled  = self.attention_pool(z).reshape(B, 64)   # [B, 64]
        weights = self.attention(pooled).reshape(B, 64, 1, 1)
        z = z * weights                                    # [B, 64, H, W]

        embedding = z

        # ── decoder ───────────────────────────────────────────────────────
        output = self.decoder(z)   # [B, 14, H, W]

        if return_embedding:
            return output, embedding
        return output
