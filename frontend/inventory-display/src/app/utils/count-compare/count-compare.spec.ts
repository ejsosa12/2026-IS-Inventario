import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CountCompare } from './count-compare';

describe('CountCompare', () => {
  let component: CountCompare;
  let fixture: ComponentFixture<CountCompare>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CountCompare],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CountCompare);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
