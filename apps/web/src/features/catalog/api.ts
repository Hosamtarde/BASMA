import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { components } from '@/api/schema.gen';

export type Technician = components['schemas']['TechnicianResponse'];
export type WorkType = components['schemas']['WorkTypeResponse'];
export type ExpenseCategory = components['schemas']['ExpenseCategoryResponse'];
export type DeleteOutcome = components['schemas']['DeleteResponse']['outcome'];

export const PAGE_SIZE = 25;

export interface ListParams {
  search: string;
  active?: boolean | undefined;
  page: number;
}

const toQuery = (p: ListParams) => ({
  search: p.search || undefined,
  active: p.active,
  page: p.page,
  pageSize: PAGE_SIZE,
});

/** Query keys per entity; any write invalidates the entity's whole family. */
export const catalogKeys = {
  technicians: ['technicians'] as const,
  workTypes: ['work-types'] as const,
  expenseCategories: ['expense-categories'] as const,
};

export const techniciansQuery = (p: ListParams) =>
  queryOptions({
    queryKey: [...catalogKeys.technicians, p],
    queryFn: () => unwrap(api.GET('/api/v1/technicians', { params: { query: toQuery(p) } })),
    placeholderData: keepPreviousData,
  });

export const workTypesQuery = (p: ListParams) =>
  queryOptions({
    queryKey: [...catalogKeys.workTypes, p],
    queryFn: () => unwrap(api.GET('/api/v1/work-types', { params: { query: toQuery(p) } })),
    placeholderData: keepPreviousData,
  });

export const expenseCategoriesQuery = (p: ListParams) =>
  queryOptions({
    queryKey: [...catalogKeys.expenseCategories, p],
    queryFn: () => unwrap(api.GET('/api/v1/expense-categories', { params: { query: toQuery(p) } })),
    placeholderData: keepPreviousData,
  });

const byId = (id: number) => ({ params: { path: { id } } });

export const technicianApi = {
  create: (name: string) => unwrap(api.POST('/api/v1/technicians', { body: { name } })),
  update: (id: number, body: components['schemas']['UpdateTechnicianRequest']) =>
    unwrap(api.PATCH('/api/v1/technicians/{id}', { ...byId(id), body })),
  remove: async (id: number) => (await unwrap(api.DELETE('/api/v1/technicians/{id}', byId(id)))).outcome,
};

export const workTypeApi = {
  create: (body: components['schemas']['CreateWorkTypeRequest']) =>
    unwrap(api.POST('/api/v1/work-types', { body })),
  update: (id: number, body: components['schemas']['UpdateWorkTypeRequest']) =>
    unwrap(api.PATCH('/api/v1/work-types/{id}', { ...byId(id), body })),
  remove: async (id: number) => (await unwrap(api.DELETE('/api/v1/work-types/{id}', byId(id)))).outcome,
};

export const expenseCategoryApi = {
  create: (name: string) => unwrap(api.POST('/api/v1/expense-categories', { body: { name } })),
  update: (id: number, body: components['schemas']['UpdateExpenseCategoryRequest']) =>
    unwrap(api.PATCH('/api/v1/expense-categories/{id}', { ...byId(id), body })),
  remove: async (id: number) =>
    (await unwrap(api.DELETE('/api/v1/expense-categories/{id}', byId(id)))).outcome,
};
