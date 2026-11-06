<?php

namespace Tests\Unit\Listeners;

use App\Listeners\LogAuthenticationEvents;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class MaskEmailTest extends TestCase
{
    /**
     * @return array<string, array{string, string}>
     */
    public static function emails(): array
    {
        return [
            'regular' => ['jane.doe@example.com', 'j*******@example.com'],
            'single char local part' => ['j@example.com', 'j*@example.com'],
            'not an email' => ['janedoe', 'j***'],
            'empty' => ['', ''],
        ];
    }

    #[DataProvider('emails')]
    public function test_mask_email(string $input, string $expected): void
    {
        $this->assertSame($expected, LogAuthenticationEvents::maskEmail($input));
    }
}
