import { DOCUMENT } from '@angular/common';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { credentialsInterceptor } from './credentials.interceptor';

describe('credentialsInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([credentialsInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    doc = TestBed.inject(DOCUMENT);
    doc.cookie = 'XSRF-TOKEN=; Max-Age=0';
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should attach withCredentials and Accept header on GET requests', () => {
    http.get('http://localhost:8000/api/tasks').subscribe();

    const req = httpMock.expectOne('http://localhost:8000/api/tasks');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get('Accept')).toBe('application/json');
    expect(req.request.headers.has('X-XSRF-TOKEN')).toBe(false);
    req.flush([]);
  });

  it('should decode XSRF-TOKEN cookie and set X-XSRF-TOKEN header on POST requests', () => {
    doc.cookie = 'XSRF-TOKEN=encoded%2Btoken%3D%3D';

    http.post('http://localhost:8000/api/tasks', { title: 'Test' }).subscribe();

    const req = httpMock.expectOne('http://localhost:8000/api/tasks');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get('X-XSRF-TOKEN')).toBe('encoded+token==');
    req.flush({});
  });
});
