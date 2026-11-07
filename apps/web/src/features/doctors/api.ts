import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { components } from '@/api/schema.gen';
import { PAGE_SIZE } from '@/features/catalog/api';
import type { ListParams } from '@/features/catalog/api';

export type Doctor = components['schemas']['DoctorResponse'];
export type DoctorPrice = components['schemas']['DoctorPriceResponse'];
export type CreateDoctor = components['schemas']['CreateDoctorRequest'];
export type UpdateDoctor = components['schemas']['UpdateDoctorRequest'];

export const doctorKeys = {
  all: ['doctors'] as const,
  list: (p: ListParams) => ['doctors', 'list', p] as const,
  one: (id: number) => ['doctors', id] as const,
  prices: (id: number) => ['doctors', id, 'prices'] as const,
};

export const doctorsQuery = (p: ListParams) =>
  queryOptions({
    queryKey: doctorKeys.list(p),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/doctors', {
          params: {
            query: { search: p.search || undefined, active: p.active, page: p.page, pageSize: PAGE_SIZE },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

export const doctorQuery = (id: number) =>
  queryOptions({
    queryKey: doctorKeys.one(id),
    queryFn: () => unwrap(api.GET('/api/v1/doctors/{id}', { params: { path: { id } } })),
  });

/** Every work type with its general price and this doctor's special price (null = general). */
export const doctorPricesQuery = (id: number) =>
  queryOptions({
    queryKey: doctorKeys.prices(id),
    queryFn: () => unwrap(api.GET('/api/v1/doctors/{id}/prices', { params: { path: { id } } })),
  });

const byId = (id: number) => ({ params: { path: { id } } });

export const doctorApi = {
  create: (body: CreateDoctor) => unwrap(api.POST('/api/v1/doctors', { body })),
  update: (id: number, body: UpdateDoctor) =>
    unwrap(api.PATCH('/api/v1/doctors/{id}', { ...byId(id), body })),
  remove: async (id: number) => (await unwrap(api.DELETE('/api/v1/doctors/{id}', byId(id)))).outcome,
  setPrice: (id: number, workTypeId: number, price: number) =>
    unwrap(
      api.PUT('/api/v1/doctors/{id}/prices/{workTypeId}', {
        params: { path: { id, workTypeId } },
        body: { price },
      }),
    ),
  clearPrice: (id: number, workTypeId: number) =>
    unwrap(api.DELETE('/api/v1/doctors/{id}/prices/{workTypeId}', { params: { path: { id, workTypeId } } })),
};
