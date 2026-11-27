"""Regression tests for safe DSP effect parameter coercion."""

import math

import pytest

from backend.services.dsp_effects import _clipf, _clipi


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf"), "nan", "inf"])
def test_float_effect_parameter_uses_default_for_non_finite_values(value):
    assert _clipf(value, 0.0, 1.0, 0.25) == 0.25


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf"), "nan", "inf"])
def test_integer_effect_parameter_uses_default_for_non_finite_values(value):
    assert _clipi(value, 1, 16, 8) == 8


def test_finite_effect_parameters_are_clamped():
    assert _clipf(2.0, 0.0, 1.0, 0.25) == 1.0
    assert _clipf(-2.0, 0.0, 1.0, 0.25) == 0.0
    assert _clipi(100, 1, 16, 8) == 16
    assert _clipi(0, 1, 16, 8) == 1
