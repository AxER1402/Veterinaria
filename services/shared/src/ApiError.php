<?php
declare(strict_types=1);

namespace Huellitas;

/** Error controlado: el mensaje sí se devuelve al cliente. */
final class ApiError extends \RuntimeException
{
    public function __construct(public readonly int $status, string $mensaje, public readonly array $extra = [])
    {
        parent::__construct($mensaje);
    }
}
