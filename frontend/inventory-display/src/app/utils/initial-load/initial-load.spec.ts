import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { InitialLoad } from './initial-load';

describe('InitialLoad', () => {
  let component: InitialLoad;
  let fixture: ComponentFixture<InitialLoad>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InitialLoad],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(InitialLoad);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
