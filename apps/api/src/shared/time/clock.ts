import { DynamicModule, Global, Module } from '@nestjs/common';

/** The only source of "now" for business rules, so tests can move time (e.g. across midnight). */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };

@Global()
@Module({})
export class ClockModule {
  static forRoot(clock: Clock = systemClock): DynamicModule {
    return { module: ClockModule, providers: [{ provide: CLOCK, useValue: clock }], exports: [CLOCK] };
  }
}
