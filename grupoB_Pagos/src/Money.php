<?php
declare(strict_types=1);
namespace Pagos;

final class Money
{
    public static function decimal(mixed $value): string
    {
        if (!is_int($value) && !is_string($value)) {
            throw new \InvalidArgumentException('total requiere un decimal exacto; no convertir primero a float');
        }
        $value = (string) $value;
        if (!preg_match('/^(0|[1-9][0-9]{0,9})(?:\.([0-9]{1,2}))?$/D', $value, $matches)) {
            throw new \InvalidArgumentException('total debe ser positivo, con maximo 10 enteros y 2 decimales');
        }
        $decimal = $matches[1] . '.' . str_pad($matches[2] ?? '', 2, '0');
        if (self::cents($decimal) <= 0) { throw new \InvalidArgumentException('total debe ser mayor que cero'); }
        return $decimal;
    }
    public static function fromJson(string $body): string
    {


        preg_match_all('~"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[{}\\[\\]:,]~s', $body, $matches);
        $tokens = $matches[0];
        $depth = 0;
        $raw = null;
        foreach ($tokens as $index => $token) {
            if ($token === '{' || $token === '[') { $depth++; continue; }
            if ($token === '}' || $token === ']') { $depth--; continue; }
            if ($depth === 1 && str_starts_with($token, '"') && ($tokens[$index + 1] ?? '') === ':'
                && json_decode($token, true, 512, JSON_THROW_ON_ERROR) === 'total') {

                $raw = $tokens[$index + 2] ?? null;
            }
        }
        if ($raw === null) { throw new \InvalidArgumentException('Falta total'); }
        if (str_starts_with($raw, '"')) {
            return self::decimal(json_decode($raw, true, 512, JSON_THROW_ON_ERROR));
        }
        if (!preg_match('/^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/D', $raw, $parts)) {
            throw new \InvalidArgumentException('total debe ser un numero positivo');
        }
        $fraction = $parts[2] ?? '';
        $exponentText = $parts[3] ?? '0';
        $exponentDigits = ltrim(ltrim($exponentText, '+-'), '0');
        if (strlen($exponentDigits) > 3) { throw new \InvalidArgumentException('total fuera de rango'); }
        $exponent = (int) $exponentText;
        $scale = strlen($fraction) - $exponent;
        if ($scale > 2) { throw new \InvalidArgumentException('total tiene mas de dos decimales'); }
        $digits = ltrim($parts[1] . $fraction, '0');
        if ($digits === '') { throw new \InvalidArgumentException('total debe ser mayor que cero'); }
        $integerLength = strlen($digits) - $scale;
        if ($integerLength > 10) { throw new \InvalidArgumentException('total fuera de DECIMAL(12,2)'); }
        if ($scale <= 0) { return self::decimal($digits . str_repeat('0', -$scale)); }
        $digits = str_pad($digits, $scale + 1, '0', STR_PAD_LEFT);
        return self::decimal(substr($digits, 0, -$scale) . '.' . substr($digits, -$scale));
    }
    public static function cents(string $decimal): int
    {
        return (int) str_replace('.', '', $decimal);
    }
}
